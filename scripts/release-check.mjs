import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, ASSETS, assetRecords, sha256, verifyBuild } from './lib.mjs';
import { verifyProduction } from './production-lib.mjs';

export async function checkRelease(){
  const lockPath=join(ROOT,'release/m1-preview-manifest.json');
  const info=await lstat(lockPath); assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1);
  const lockBytes=await readFile(lockPath);
  assert.equal(sha256(lockBytes),'5c708d04f91b64539a9b44f757a85263fb9a2f47f16d024ee40cfbcf0344c1ca','M1 asset lock changed');
  const lock=JSON.parse(lockBytes);
  assert.deepEqual(lock.files.map(file=>file.path),ASSETS);
  assert.deepEqual(await assetRecords(join(ROOT,'public')),lock.files,'Approved M1 public assets changed');
  const preview=await verifyBuild();
  const production=await verifyProduction();
  assert.deepEqual(preview,lock,'Production build overwrote the preview');
  const pkg=JSON.parse(await readFile(join(ROOT,'package.json'),'utf8'));
  assert.equal(pkg.scripts['build:production'],'node scripts/build-production.mjs');
  assert.equal(pkg.scripts['check:production'],'node scripts/check-production.mjs');
  assert.equal(pkg.scripts['release:check'],'node scripts/release-check.mjs');
  assert.equal(pkg.scripts['preview:production'],'node scripts/serve-production.mjs');
  return {previewAssets:preview.files.length,productionAssets:production.files.length,approvedM1PublicUnchanged:true};
}

if(process.argv[1]?.replaceAll('\\','/').endsWith('/scripts/release-check.mjs')){
  const report=await checkRelease();
  process.stdout.write(`PASS: release checks; ${report.previewAssets} locked preview assets, ${report.productionAssets} production assets, M1 public bytes unchanged.\n`);
}
