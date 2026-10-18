import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { ROOT, ASSETS, assetRecords } from '../scripts/lib.mjs';
import { ORIGIN, PRODUCTION_ASSETS, renderProduction, validateProduction, robotsAllows, parseHeaderRules, modelHeaders, validateWrangler, recordsForMap } from '../scripts/production-lib.mjs';
import { createProductionModel } from '../scripts/serve-production.mjs';

const production=await renderProduction();
const cloned=()=>new Map([...production].map(([path,data])=>[path,Buffer.from(data)]));
const modify=(files,path,from,to)=>{const text=files.get(path).toString('utf8');assert(text.includes(from));files.set(path,Buffer.from(text.replace(from,to)));};

test('production contains exactly 9 assets, unchanged bodies and unchanged executable assets',async()=>{
  assert.deepEqual([...production.keys()].sort(),['_headers','404.html','en/index.html','index.html','js/app.js','js/core/print-size.js','robots.txt','sitemap.xml','styles/app.css'].sort());
  assert.deepEqual(await validateProduction(production),{files:9,canonicalPages:2});
  for(const path of ['index.html','en/index.html']){
    const preview=await readFile(join(ROOT,'public',path),'utf8');
    const output=production.get(path).toString('utf8');
    assert.equal(output.slice(output.indexOf('<body>')),preview.slice(preview.indexOf('<body>')));
    assert.match(preview,/noindex,nofollow/); assert.doesNotMatch(preview,/canonical|application\/ld\+json/);
  }
  for(const path of ['js/app.js','js/core/print-size.js','styles/app.css'])assert(production.get(path).equals(await readFile(join(ROOT,'public',path))));
});
test('both canonical pages have exact self URLs and reciprocal zh-Hant/en/x-default',()=>{
  for(const path of ['index.html','en/index.html']){
    const html=production.get(path).toString('utf8');
    assert(html.includes(`<link rel="canonical" href="https://printsize.glossquote.com/${path}">`));
    assert(html.includes('<link rel="alternate" hreflang="zh-Hant" href="https://printsize.glossquote.com/index.html">'));
    assert(html.includes('<link rel="alternate" hreflang="en" href="https://printsize.glossquote.com/en/index.html">'));
    assert(html.includes('<link rel="alternate" hreflang="x-default" href="https://printsize.glossquote.com/index.html">'));
  }
});
test('WebApplication metadata is truthful and its exact UTF-8 bytes determine the sole CSP hash',()=>{
  const rules=parseHeaderRules(production.get('_headers').toString('utf8'));
  for(const [path,lang,name] of [['index.html','zh-Hant','圖片列印尺寸試算'],['en/index.html','en','Image Print Size Calculator']]){
    const html=production.get(path).toString('utf8');
    const content=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1];
    const data=JSON.parse(content);
    assert.equal(data['@context'],'https://schema.org'); assert.equal(data['@type'],'WebApplication');
    assert.equal(data.name,name);assert.equal(data.inLanguage,lang);assert.equal(data.url,`https://printsize.glossquote.com/${path}`);
    assert(!('offers'in data)&&!('aggregateRating'in data)&&!('review'in data)&&!('operatingSystem'in data));
    const hash=createHash('sha256').update(Buffer.from(content,'utf8')).digest('base64');
    const csp=modelHeaders(rules,'/'+path)['content-security-policy'];
    assert(csp.includes(`script-src 'self' 'sha256-${hash}'`));
    assert.equal([...csp.matchAll(/sha256-/g)].length,1);
    for(const directive of ["default-src 'none'","connect-src 'none'","form-action 'none'","frame-ancestors 'none'","object-src 'none'","base-uri 'none'"])assert(csp.includes(directive));
    assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/);
  }
});
test('headers merge matching rules and detachment removes inherited values case-insensitively',()=>{
  const text='/*\n  X-Robots-Tag: noindex\n  X-Test: first\n\n/index.html\n  ! x-robots-tag\n  X-Robots-Tag: index, follow\n  X-Test: second\n';
  const rules=parseHeaderRules(text);
  assert.deepEqual(modelHeaders(rules,'/index.html'),{'x-robots-tag':'index, follow','x-test':'first, second'});
  assert.deepEqual(modelHeaders(rules,'/other'),{'x-robots-tag':'noindex','x-test':'first'});
  const missingDetach=parseHeaderRules(text.replace('  ! x-robots-tag\n',''));
  assert.equal(modelHeaders(missingDetach,'/index.html')['x-robots-tag'],'noindex, index, follow');
});
test('actual canonical headers contain index only; 404 and all other routes stay noindex',()=>{
  const rules=parseHeaderRules(production.get('_headers').toString('utf8'));
  for(const path of ['/index.html','/en/index.html'])assert.equal(modelHeaders(rules,path)['x-robots-tag'],'index, follow');
  for(const path of ['/','/en/','/missing','/404.html','/_headers','/js/app.js'])assert.equal(modelHeaders(rules,path)['x-robots-tag'],'noindex, nofollow');
});
test('robots applies longest matching prefix/exact rules, with Allow winning equal specificity',()=>{
  const text='User-agent: *\nDisallow: /\nAllow: /js/\nDisallow: /js/private/\nAllow: /index.html$\nDisallow: /tie/\nAllow: /tie/\n';
  assert.equal(robotsAllows(text,'/js/app.js'),true);
  assert.equal(robotsAllows(text,'/js/private/app.js'),false);
  assert.equal(robotsAllows(text,'/index.html'),true);
  assert.equal(robotsAllows(text,'/index.html/missing'),false);
  assert.equal(robotsAllows(text,'/tie/item'),true);
  assert.equal(robotsAllows('User-agent: *\nAllow: /styles/\nDisallow: /styles/app.css$\n','/styles/app.css'),false);
});
test('production robots actually allows every HTML/JS/CSS dependency and sitemap has only canonical pages',()=>{
  const robots=production.get('robots.txt').toString('utf8');
  for(const path of ['/index.html','/en/index.html','/js/app.js','/js/core/print-size.js','/styles/app.css','/sitemap.xml','/robots.txt'])assert.equal(robotsAllows(robots,path),true,path);
  for(const path of ['/','/en/','/404.html','/private','/index.htmlx'])assert.equal(robotsAllows(robots,path),false,path);
  assert.deepEqual([...production.get('sitemap.xml').toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]),['https://printsize.glossquote.com/index.html','https://printsize.glossquote.com/en/index.html']);
});
test('source preview manifest is exactly the approved M1 asset set',async()=>{
  const bytes=await readFile(join(ROOT,'release/m1-preview-manifest.json'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),'5c708d04f91b64539a9b44f757a85263fb9a2f47f16d024ee40cfbcf0344c1ca');
  const lock=JSON.parse(bytes);assert.deepEqual(lock.files.map(file=>file.path),ASSETS);
  assert.deepEqual(await assetRecords(join(ROOT,'public')),lock.files);
});
test('Wrangler has no script/binding/secret/telemetry or alternate origin capability',async()=>{
  const text=await readFile(join(ROOT,'wrangler.jsonc'),'utf8'); const config=validateWrangler(text);
  assert.equal(config.name,'glossquote-print-size');assert.equal(config.compatibility_date,'2026-10-18');
  for(const mutate of [c=>c.workers_dev=true,c=>c.preview_urls=true,c=>c.send_metrics=true,c=>c.observability.logs.enabled=true,c=>c.observability.traces.enabled=true,c=>c.compatibility_date='2026-10-17',c=>c.assets.html_handling='auto-trailing-slash',c=>c.assets.not_found_handling='single-page-application',c=>c.routes[0].pattern='elsewhere.invalid',c=>c.main='./worker.js',c=>c.vars={example:'not_allowed'}]){
    const changed=structuredClone(config);mutate(changed);assert.throws(()=>validateWrangler(JSON.stringify(changed,null,2)+'\n'));
  }
  assert.throws(()=>validateWrangler(text.replace('"workers_dev": false','"workers_dev": false,\n  "workers_dev": false')));
});
test('missing header detachment, wrong CSP hash, canonical and alternate mutations fail release validation',async()=>{
  const mutations=[
    ['_headers','  ! X-Robots-Tag\n',''],
    ['_headers','  ! Content-Security-Policy\n',''],
    ['_headers',"'sha256-","'sha256-wrong"],
    ['index.html','rel="canonical" href="https://printsize.glossquote.com/index.html"','rel="canonical" href="https://elsewhere.invalid/index.html"'],
    ['en/index.html','hreflang="x-default" href="https://printsize.glossquote.com/index.html"','hreflang="x-default" href="https://printsize.glossquote.com/en/index.html"'],
    ['js/core/print-size.js','export function calculatePrintSize','export function modifiedCalculatePrintSize'],
    ['404.html','content="noindex,nofollow"','content="index,follow"'],
    ['robots.txt','Allow: /js/\n','']
  ];
  for(const [path,from,to]of mutations){const files=cloned();modify(files,path,from,to);await assert.rejects(validateProduction(files),undefined,path);}
});
test('unexpected production assets and malformed header syntax fail closed',async()=>{
  const files=cloned();files.set('extra.js',Buffer.from('no'));await assert.rejects(validateProduction(files));
  assert.throws(()=>parseHeaderRules('  Content-Type: text/html\n'));
  assert.throws(()=>parseHeaderRules('/**\n  X-Test: x\n'));
  assert.throws(()=>parseHeaderRules('https://elsewhere.invalid/*\n  X-Test: x\n'));
});
test('production asset records are sorted, bounded and exclude the external manifest',()=>{
  const records=recordsForMap(production);assert.equal(records.length,9);
  assert.deepEqual(records.map(r=>r.path),PRODUCTION_ASSETS);
  for(const record of records){assert(record.bytes>0);assert.match(record.sha256,/^[a-f0-9]{64}$/);}
  assert(!records.some(record=>record.path.includes('manifest')));
});

function http(port,path,method='GET'){
  return new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path,method},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end();
  });
}
test('production HTTP model serves exact bytes, headers and MIME; no SPA/config/metadata exposure',async()=>{
  const files=cloned(),server=await createProductionModel(files);
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try{
    assert.equal(server.address().address,'127.0.0.1');const port=server.address().port;
    files.set('index.html',Buffer.from('changed after startup'));
    for(const path of PRODUCTION_ASSETS.filter(path=>path!=='_headers')){
      const response=await http(port,'/'+path);assert.equal(response.status,path==='404.html'?404:200,path);
      assert(response.body.equals(production.get(path)),path);
      assert.equal(response.headers['x-robots-tag'],['index.html','en/index.html'].includes(path)?'index, follow':'noindex, nofollow');
      assert.equal(response.headers['x-content-type-options'],'nosniff');assert.equal(response.headers['cache-control'],'no-store');
      assert(response.headers['content-security-policy'].includes("connect-src 'none'"));
      const head=await http(port,'/'+path,'HEAD');assert.equal(head.status,response.status);assert.equal(head.body.length,0);assert.equal(head.headers['content-length'],response.headers['content-length']);
    }
    assert.match((await http(port,'/sitemap.xml')).headers['content-type'],/^application\/xml/);
    assert.match((await http(port,'/js/app.js')).headers['content-type'],/^text\/javascript/);
    for(const path of ['/','/en/','/index','/en/index','/missing','/api/calculate','/_headers','/manifest.json','/dist-production-manifest.json','/wrangler.jsonc','/package.json','/../index.html','/%2e%2e/index.html','//index.html','/index.html#fragment']){
      const response=await http(port,path);assert.equal(response.status,404,path);assert(response.body.equals(production.get('404.html')));assert.equal(response.headers['x-robots-tag'],'noindex, nofollow');
    }
    const query=await http(port,'/index.html?test=fixture');assert.equal(query.status,200);assert(query.body.equals(production.get('index.html')));
    for(const method of ['POST','PUT','DELETE','OPTIONS']){
      const response=await http(port,'/index.html',method);assert.equal(response.status,405);assert.equal(response.headers.allow,'GET, HEAD');assert.equal(response.headers['x-robots-tag'],'noindex, nofollow');
    }
  }finally{await new Promise(resolve=>server.close(resolve));}
});
