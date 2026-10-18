import { mkdir, lstat, writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { ROOT, ASSETS, checkSource, inspectTree, verifyBuild } from './lib.mjs';

const files = await checkSource();
const target = resolve(ROOT, 'dist');
try {
  await lstat(target);
  await inspectTree(target, [...ASSETS, 'manifest.json']);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  // An incomplete existing build is never silently overwritten.
  try { await lstat(target); assert.fail('incomplete existing build'); }
  catch (rootError) { if (rootError.code !== 'ENOENT') throw rootError; }
}
await mkdir(target, { recursive: true });
for (const path of ASSETS) {
  const destination = join(target, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(resolve(ROOT, 'public', path)));
}
await writeFile(join(target, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, mode: 'M1-preview', files }, null, 2)}\n`);
await verifyBuild();
process.stdout.write('PASS: M1 preview built and verified in dist/; manifest covers 7 assets (excludes itself).\n');
