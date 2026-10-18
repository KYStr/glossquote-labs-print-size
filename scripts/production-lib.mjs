import assert from 'node:assert/strict';
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT, ASSETS, HEADERS, checkSource, inspectTree, assetRecords, sha256 } from './lib.mjs';

export const ORIGIN = 'https://printsize.glossquote.com';
export const PRODUCTION_ASSETS = Object.freeze([...ASSETS, '_headers', 'sitemap.xml'].sort());
export const PAGES = Object.freeze([
  { path: 'index.html', lang: 'zh-Hant' },
  { path: 'en/index.html', lang: 'en' }
]);
export const PRODUCTION_DIRECTORY = resolve(ROOT, 'dist-production');
export const PRODUCTION_MANIFEST = resolve(ROOT, 'dist-production-manifest.json');
const BASE_CSP = HEADERS['Content-Security-Policy'];
const CSP_HASH = text => `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
const attribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

export function validateWrangler(text) {
  const config = JSON.parse(text);
  assert.equal(`${JSON.stringify(config, null, 2)}\n`, text, 'Wrangler must be canonical plain JSON, without duplicate keys or comments');
  assert.deepEqual(config, {
    name: 'glossquote-print-size', compatibility_date: '2026-10-18',
    workers_dev: false, preview_urls: false, send_metrics: false,
    assets: { directory: './dist-production', html_handling: 'none', not_found_handling: '404-page' },
    routes: [{ pattern: 'printsize.glossquote.com', custom_domain: true }],
    observability: { enabled: false, logs: { enabled: false }, traces: { enabled: false } }
  }, 'Unexpected deployment configuration or capability');
  return config;
}

function metadata(html, page) {
  const name = html.match(/<h1>([^<]+)<\/h1>/)?.[1];
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1];
  assert(name && title && description, 'Missing visible metadata');
  assert(html.includes(`<html lang="${page.lang}">`));
  return { name, title, description };
}

function productionPage(html, page) {
  const meta = metadata(html, page);
  const url = `${ORIGIN}/${page.path}`;
  const structured = {
    '@context': 'https://schema.org', '@type': 'WebApplication', name: meta.name,
    url, inLanguage: page.lang, applicationCategory: 'UtilitiesApplication',
    description: meta.description, browserRequirements: 'Requires JavaScript'
  };
  const json = JSON.stringify(structured).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  const head = [
    `  <link rel="canonical" href="${url}">`,
    ...PAGES.map(other => `  <link rel="alternate" hreflang="${other.lang}" href="${ORIGIN}/${other.path}">`),
    `  <link rel="alternate" hreflang="x-default" href="${ORIGIN}/index.html">`,
    `  <meta property="og:type" content="website">`,
    `  <meta property="og:title" content="${attribute(meta.title)}">`,
    `  <meta property="og:description" content="${attribute(meta.description)}">`,
    `  <meta property="og:url" content="${url}">`,
    `  <script type="application/ld+json">${json}</script>`
  ].join('\n');
  const robots = '<meta name="robots" content="noindex,nofollow">';
  assert.equal(html.split(robots).length, 2);
  assert.equal(html.split('</head>').length, 2);
  const output = html.replace(robots, '<meta name="robots" content="index,follow">').replace('</head>', `${head}\n</head>`);
  assert.equal(output.slice(output.indexOf('<body>')), html.slice(html.indexOf('<body>')), 'UI body changed');
  return { html: output, csp: BASE_CSP.replace("script-src 'self'", `script-src 'self' '${CSP_HASH(json)}'`) };
}

export const ROBOTS = [
  'User-agent: *', 'Allow: /index.html$', 'Allow: /en/index.html$',
  'Allow: /robots.txt$', 'Allow: /sitemap.xml$', 'Allow: /js/', 'Allow: /styles/',
  'Disallow: /', `Sitemap: ${ORIGIN}/sitemap.xml`, ''
].join('\n');

/** Longest matching prefix/exact rule for the bounded REP subset we emit. */
export function robotsAllows(text, target) {
  assert(typeof target === 'string' && target.startsWith('/'));
  let agent = false;
  const candidates = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const split = line.indexOf(':'); assert(split > 0, 'Invalid robots directive');
    const key = line.slice(0,split).toLowerCase(), value = line.slice(split+1).trim();
    if (key === 'user-agent') { assert.equal(value,'*'); agent = true; continue; }
    if (key === 'sitemap') continue;
    assert(agent && ['allow','disallow'].includes(key), 'Unsupported robots directive');
    assert(/^\/[A-Za-z0-9_./-]*\$?$/.test(value), 'Unsupported robots rule');
    const exact = value.endsWith('$'), path = exact ? value.slice(0,-1) : value;
    if (exact ? target === path : target.startsWith(path)) candidates.push({length:path.length,allow:key==='allow'});
  }
  if (!candidates.length) return true;
  candidates.sort((a,b)=>b.length-a.length || Number(b.allow)-Number(a.allow));
  return candidates[0].allow;
}

/** Model the matching/merging/detachment subset used by this _headers file. */
export function parseHeaderRules(text) {
  const rules=[];
  let current;
  for (const raw of text.split('\n')) {
    assert(raw.length <= 2000, 'Header line too long');
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      assert(/^\/[A-Za-z0-9_./*\-]*$/.test(raw) && raw.split('*').length <= 2, 'Unsupported header pattern');
      current={pattern:raw,operations:[]}; rules.push(current); continue;
    }
    assert(current, 'Header without a rule');
    const line=raw.trim();
    if (line.startsWith('! ')) {
      const name=line.slice(2); assert(/^[A-Za-z0-9-]+$/.test(name));
      current.operations.push({name:name.toLowerCase(),remove:true});
    } else {
      const split=line.indexOf(':'); assert(split>0);
      const name=line.slice(0,split), value=line.slice(split+1).trim();
      assert(/^[A-Za-z0-9-]+$/.test(name) && value && !/[\r\n]/.test(value));
      current.operations.push({name:name.toLowerCase(),value});
    }
  }
  assert(rules.length>0 && rules.length<=100);
  return rules;
}

function matches(pattern, target) {
  const star=pattern.indexOf('*');
  if (star<0) return pattern===target;
  const before=pattern.slice(0,star), after=pattern.slice(star+1);
  return target.startsWith(before) && target.endsWith(after) && target.length>=before.length+after.length;
}

export function modelHeaders(rules, target) {
  const headers={};
  for (const rule of rules) {
    if (!matches(rule.pattern,target)) continue;
    for (const operation of rule.operations) {
      if (operation.remove) delete headers[operation.name];
      else headers[operation.name]=Object.hasOwn(headers,operation.name) ? `${headers[operation.name]}, ${operation.value}` : operation.value;
    }
  }
  return headers;
}

export async function renderProduction() {
  await checkSource();
  validateWrangler(await readFile(join(ROOT,'wrangler.jsonc'),'utf8'));
  const files=new Map(await Promise.all(ASSETS.map(async path=>[path,await readFile(join(ROOT,'public',path))])));
  const csp=new Map();
  for (const page of PAGES) {
    const output=productionPage(files.get(page.path).toString('utf8'),page);
    files.set(page.path,Buffer.from(output.html)); csp.set(page.path,output.csp);
  }
  files.set('robots.txt',Buffer.from(ROBOTS));
  files.set('sitemap.xml',Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map(page=>`  <url><loc>${ORIGIN}/${page.path}</loc></url>`).join('\n')}\n</urlset>\n`));
  const base={...HEADERS,'Strict-Transport-Security':'max-age=31536000'};
  const headers=[
    '/*', ...Object.entries(base).map(([name,value])=>`  ${name}: ${value}`), '',
    ...PAGES.flatMap(page=>[
      `/${page.path}`, '  ! X-Robots-Tag', '  X-Robots-Tag: index, follow',
      '  ! Content-Security-Policy', `  Content-Security-Policy: ${csp.get(page.path)}`, ''
    ])
  ].join('\n');
  files.set('_headers',Buffer.from(headers));
  return files;
}

export async function validateProduction(files) {
  assert.deepEqual([...files.keys()].sort(),PRODUCTION_ASSETS);
  for (const data of files.values()) assert(Buffer.isBuffer(data) && data.length>0);
  const rules=parseHeaderRules(files.get('_headers').toString('utf8'));
  const robots=files.get('robots.txt').toString('utf8');
  assert.equal(robots,ROBOTS);
  assert.deepEqual([...files.get('sitemap.xml').toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(match=>match[1]),PAGES.map(page=>`${ORIGIN}/${page.path}`));
  for (const page of PAGES) {
    const html=files.get(page.path).toString('utf8');
    const preview=await readFile(join(ROOT,'public',page.path),'utf8');
    const meta=metadata(preview,page), url=`${ORIGIN}/${page.path}`;
    assert.equal(html.slice(html.indexOf('<body>')),preview.slice(preview.indexOf('<body>')),'Production changed the UI body');
    assert.match(html,/<meta name="robots" content="index,follow">/);
    assert.equal([...html.matchAll(/rel="canonical"/g)].length,1);
    assert(html.includes(`<link rel="canonical" href="${url}">`));
    assert.deepEqual([...html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)">/g)].map(match=>[match[1],match[2]]),[
      ['zh-Hant',`${ORIGIN}/index.html`],['en',`${ORIGIN}/en/index.html`],['x-default',`${ORIGIN}/index.html`]
    ]);
    assert(html.includes(`<meta property="og:title" content="${attribute(meta.title)}">`));
    assert(html.includes(`<meta property="og:description" content="${attribute(meta.description)}">`));
    assert(html.includes(`<meta property="og:url" content="${url}">`));
    const scripts=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length,2);
    const inline=scripts.filter(match=>match[1]===' type="application/ld+json"'); assert.equal(inline.length,1);
    assert.deepEqual(JSON.parse(inline[0][2]),{
      '@context':'https://schema.org','@type':'WebApplication',name:meta.name,url,inLanguage:page.lang,
      applicationCategory:'UtilitiesApplication',description:meta.description,browserRequirements:'Requires JavaScript'
    });
    const headers=modelHeaders(rules,`/${page.path}`);
    assert.equal(headers['x-robots-tag'],'index, follow','Inherited noindex must be detached');
    assert.equal(headers['content-security-policy'],BASE_CSP.replace("script-src 'self'",`script-src 'self' '${CSP_HASH(inline[0][2])}'`));
    assert.doesNotMatch(headers['content-security-policy'],/unsafe-inline|unsafe-eval/);
    assert(robotsAllows(robots,`/${page.path}`));
  }
  for (const path of ['js/app.js','js/core/print-size.js','styles/app.css','404.html']) {
    assert(files.get(path).equals(await readFile(join(ROOT,'public',path))),`Changed preview asset: ${path}`);
  }
  for (const path of ['js/app.js','js/core/print-size.js','styles/app.css','robots.txt','sitemap.xml']) assert(robotsAllows(robots,`/${path}`),`robots blocked required asset: ${path}`);
  for (const path of ['/404.html','/missing','/','/en/','/_headers']) assert.equal(modelHeaders(rules,path)['x-robots-tag'],'noindex, nofollow');
  const notFound=files.get('404.html').toString('utf8');
  assert.match(notFound,/<meta name="robots" content="noindex,nofollow">/);
  assert.doesNotMatch(notFound,/<form|canonical|application\/ld\+json/);
  return {files:PRODUCTION_ASSETS.length,canonicalPages:PAGES.length};
}

function productionManifest(records) {
  return {schemaVersion:1,mode:'production',origin:ORIGIN,compatibilityDate:'2026-10-18',files:records};
}

export async function buildProduction() {
  const files=await renderProduction(); await validateProduction(files);
  try { await lstat(PRODUCTION_DIRECTORY); await inspectTree(PRODUCTION_DIRECTORY,PRODUCTION_ASSETS); }
  catch(error) {
    if(error.code!=='ENOENT')throw error;
    try { await lstat(PRODUCTION_DIRECTORY); assert.fail('Incomplete existing production build'); }
    catch(rootError){if(rootError.code!=='ENOENT')throw rootError;}
  }
  try { const info=await lstat(PRODUCTION_MANIFEST); assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1); }
  catch(error){if(error.code!=='ENOENT')throw error;}
  await mkdir(PRODUCTION_DIRECTORY,{recursive:true});
  for(const path of PRODUCTION_ASSETS){
    const target=join(PRODUCTION_DIRECTORY,path); await mkdir(dirname(target),{recursive:true}); await writeFile(target,files.get(path));
  }
  const manifest=productionManifest(await assetRecords(PRODUCTION_DIRECTORY,PRODUCTION_ASSETS));
  await writeFile(PRODUCTION_MANIFEST,JSON.stringify(manifest,null,2)+'\n');
  return verifyProduction();
}

export async function verifyProduction() {
  const expected=await renderProduction();
  await inspectTree(PRODUCTION_DIRECTORY,PRODUCTION_ASSETS);
  const files=new Map(await Promise.all(PRODUCTION_ASSETS.map(async path=>[path,await readFile(join(PRODUCTION_DIRECTORY,path))])));
  for(const path of PRODUCTION_ASSETS)assert(files.get(path).equals(expected.get(path)),`Stale or modified production asset: ${path}`);
  await validateProduction(files);
  const info=await lstat(PRODUCTION_MANIFEST); assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);
  const manifest=JSON.parse(await readFile(PRODUCTION_MANIFEST,'utf8'));
  assert.deepEqual(manifest,productionManifest(await assetRecords(PRODUCTION_DIRECTORY,PRODUCTION_ASSETS)));
  return manifest;
}

export function recordsForMap(files) {
  return [...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([path,data])=>({path,bytes:data.length,sha256:sha256(data)}));
}
