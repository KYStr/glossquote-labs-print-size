import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const ASSETS = Object.freeze([
  '404.html', 'en/index.html', 'index.html', 'js/app.js',
  'js/core/print-size.js', 'robots.txt', 'styles/app.css'
]);
export const HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; font-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store'
});
const DIRECTORIES = new Set(['en', 'js', 'js/core', 'styles']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function inspectTree(directory, allowed = ASSETS) {
  const rootInfo = await lstat(directory);
  assert(rootInfo.isDirectory() && !rootInfo.isSymbolicLink(), 'unsafe asset root');
  const files = [];
  async function walk(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      const name = relative(directory, path).split(sep).join('/');
      const info = await lstat(path);
      assert(!info.isSymbolicLink(), `linked asset rejected: ${name}`);
      if (info.isDirectory()) {
        assert(DIRECTORIES.has(name), `unknown directory: ${name}`);
        await walk(path);
      } else {
        assert(info.isFile() && info.nlink === 1, `non-regular or hardlinked asset: ${name}`);
        assert(allowed.includes(name), `unknown asset: ${name}`);
        files.push(name);
      }
    }
  }
  await walk(directory);
  assert.deepEqual(files.sort(), [...allowed].sort(), 'missing or unexpected assets');
  return files;
}

export function isApprovedReference(ref) {
  return typeof ref === 'string' && (ref === '#workspace' ||
    (ref.startsWith('/') && ASSETS.includes(ref.slice(1))) ||
    ['https://glossquote.com/index.html', 'https://glossquote.com/en/index.html'].includes(ref));
}

export async function assetRecords(directory, assets = ASSETS) {
  return Promise.all(assets.map(async path => {
    const data = await readFile(join(directory, path));
    return { path, bytes: data.byteLength, sha256: sha256(data) };
  }));
}

export async function checkSource() {
  assert(Number(process.versions.node.split('.')[0]) >= 24, 'Node 24+ required');
  const directory = resolve(ROOT, 'public');
  await inspectTree(directory);
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.equal(Object.keys(pkg[key] ?? {}).length, 0, 'external packages forbidden');
  }
  for (const path of ASSETS) {
    const text = await readFile(join(directory, path), 'utf8');
    if (path.endsWith('.html')) {
      assert.match(text, /<meta name="robots" content="noindex,nofollow">/);
      assert.doesNotMatch(text, /canonical|hreflang|application\/ld\+json|<style\b|\sstyle=|\son[a-z]+\s*=/i);
      assert.doesNotMatch(text, /<script(?! type="module" src="\/js\/app\.js"><\/script>)/i);
      const refs = [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map(match => match[1]);
      for (const ref of refs) {
        assert(isApprovedReference(ref), `unapproved reference: ${ref}`);
      }
      if (path !== '404.html') {
        assert.match(text, /<fieldset id="inputs" disabled>/);
        assert.match(text, /<noscript>/);
        assert.equal([...text.matchAll(/<input\b/g)].length, 4);
        assert.doesNotMatch(text, /<input[^>]*\bname\s*=|type="(?:file|number|hidden)"/i);
        assert.match(text, /id="targetPpiRaw"[^>]*value="300"/);
        for (const button of text.matchAll(/<button\b[^>]*>/g)) assert.match(button[0], /\bdisabled\b/);
      }
    }
    if (path.endsWith('.js') || path.endsWith('.css')) {
      assert.doesNotMatch(text, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|Worker|SharedWorker|sendBeacon|localStorage|sessionStorage|indexedDB|caches|serviceWorker|clipboard|buildReport)\b/);
      assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|document\.cookie|console\.|createObjectURL|revokeObjectURL|\beval\s*\(|\bFunction\s*\(|https?:\/\//);
    }
    if (path.endsWith('.js')) {
      const syntax = spawnSync(process.execPath, ['--check', join(directory, path)], { encoding: 'utf8', windowsHide: true });
      assert.equal(syntax.status, 0, `syntax check failed: ${path}`);
      for (const match of text.matchAll(/\bimport\s+.*?from\s+['"]([^'"]+)['"]/g)) {
        assert(match[1].startsWith('./'), 'external import forbidden');
      }
    }
  }
  assert.equal(await readFile(join(directory, 'robots.txt'), 'utf8'), 'User-agent: *\nDisallow: /\n');
  return assetRecords(directory);
}

export async function verifyBuild() {
  const directory = resolve(ROOT, 'dist');
  await inspectTree(directory, [...ASSETS, 'manifest.json']);
  const actual = await assetRecords(directory);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest, { schemaVersion: 1, mode: 'M1-preview', files: actual }, 'build manifest mismatch');
  assert.deepEqual(actual, await assetRecords(resolve(ROOT, 'public')), 'stale build');
  return manifest;
}
