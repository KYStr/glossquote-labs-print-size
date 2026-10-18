import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { request } from 'node:http';
import { ROOT, ASSETS, HEADERS, checkSource, inspectTree, isApprovedReference } from '../scripts/lib.mjs';
import { createPreviewServer } from '../scripts/serve.mjs';

test('offline source allowlist, dependency, JS syntax, privacy and noindex gate', async () => {
  const records = await checkSource();
  assert.equal(records.length, 7);
  for (const record of records) { assert(record.bytes > 0); assert.match(record.sha256, /^[a-f0-9]{64}$/); }
});
test('both language forms are blank, fail closed, labelled, bounded and have no field names', async () => {
  for (const path of ['index.html','en/index.html']) {
    const html = await readFile(join(ROOT,'public',path),'utf8');
    const inputs = [...html.matchAll(/<input\b[^>]+>/g)].map(match => match[0]);
    assert.equal(inputs.length, 4);
    for (const [i,input] of inputs.entries()) {
      assert.match(input, /type="text"/);
      assert.match(input, new RegExp(`maxlength="${[6,6,8,4][i]}"`));
      assert.match(input, new RegExp(`inputmode="${i===2?'decimal':'numeric'}"`));
      assert.doesNotMatch(input, /\bname=|\bplaceholder=/);
      if (i<3) assert.doesNotMatch(input, /\bvalue=/);
      const id = input.match(/id="([^"]+)"/)[1];
      assert(html.includes(`<label for="${id}">`));
      assert(html.includes(`id="${id}-error"`));
    }
    assert.match(html, /<fieldset id="inputs" disabled>/);
    assert.match(html, /<form id="print-form" autocomplete="off" novalidate>/);
    assert.match(html, /role="alert" hidden/);
    assert.match(html, /<dialog[^>]+aria-labelledby="confirm-title"/);
    assert.equal([...html.matchAll(/<details>/g)].length,4);
  }
});
test('initial submit capture cancels before readiness; lifecycle and exact status use explicit states', async () => {
  const js = await readFile(join(ROOT,'public/js/app.js'),'utf8');
  assert.match(js, /addEventListener\('submit', event => \{\s*event\.preventDefault\(\);\s*if \(!ready\) return;/);
  assert.match(js, /\{ capture: true \}/);
  assert(js.indexOf('ready = true;') > js.indexOf("window.addEventListener('pageshow'"));
  assert.match(js, /fields\.targetPpiRaw\.value !== '300'/);
  assert.match(js, /result\.meetsTarget \?/);
  assert.match(js, /revision \+= 1/);
  assert.match(js, /result = null/);
  assert.match(js, /event\.persisted/);
  assert.match(js, /setRangeText\('\.', start, end, 'end'\)/);
});
test('shared contrast, target sizing, 320px reflow and reduced motion hooks', async () => {
  const css = await readFile(join(ROOT,'public/styles/app.css'),'utf8');
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /max-width: 47\.999rem/);
  assert.match(css, /overflow-wrap: anywhere/);
  const luminance = hex => {
    const c = hex.match(/[a-f0-9]{2}/gi).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
    return .2126*c[0]+.7152*c[1]+.0722*c[2];
  };
  const ratio = (a,b) => { const x=luminance(a),y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  for (const bg of ['ffffff','f3f0e8']) {
    assert(ratio('111410',bg)>=4.5); assert(ratio('55594f',bg)>=4.5); assert(ratio('60645c',bg)>=3);
  }
  for (const [fg,bg] of [['245c16','e8f8c7'],['713f00','fff0d5'],['8f2119','ffe6e1'],['111410','c8f56a']]) assert(ratio(fg,bg)>=4.5);
});
test('asset inventory rejects unknown files without reading their contents', async () => {
  await assert.rejects(inspectTree(join(ROOT,'public'), ASSETS.filter(x=>x!=='robots.txt')), /unknown asset/);
});
test('reference gate requires the leading slash before stripping it', () => {
  for (const ref of ['xindex.html','xjs/app.js','xstyles/app.css','index.html','./index.html','//index.html','../index.html','/js/../index.html','/%2e%2e/index.html','https://elsewhere.invalid/index.html']) {
    assert.equal(isApprovedReference(ref),false,ref);
  }
  for (const ref of ['/index.html','/en/index.html','/js/app.js','/styles/app.css','#workspace','https://glossquote.com/index.html','https://glossquote.com/en/index.html']) {
    assert.equal(isApprovedReference(ref),true,ref);
  }
});

function http(port,path,method='GET') {
  return new Promise((resolve,reject) => {
    const req=request({hostname:'127.0.0.1',port,path,method},res=>{
      const chunks=[]; res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    }); req.on('error',reject); req.end();
  });
}
test('loopback HTTP static allowlist, HEAD, MIME, security headers, 404 and 405', async () => {
  const server = await createPreviewServer({source:true});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  try {
    assert.equal(server.address().address,'127.0.0.1');
    const port=server.address().port;
    for (const path of ['/','/index.html','/en/index.html','/styles/app.css','/js/app.js','/js/core/print-size.js','/robots.txt']) {
      const reply=await http(port,path);
      assert.equal(reply.status,200,path);
      for (const [key,value] of Object.entries(HEADERS)) assert.equal(reply.headers[key.toLowerCase()],value);
      assert(reply.body.length>0);
      const head=await http(port,path,'HEAD'); assert.equal(head.status,200); assert.equal(head.body,'');
      assert.equal(head.headers['content-length'],reply.headers['content-length']);
    }
    assert.match((await http(port,'/js/app.js')).headers['content-type'],/^text\/javascript/);
    assert.match((await http(port,'/styles/app.css')).headers['content-type'],/^text\/css/);
    for (const path of ['/404.html','/missing','/en/','/api/calculate','/manifest.json','/package.json','/../package.json','/%2e%2e/package.json','//index.html','/index.html?pixelWidthRaw=3000','/sitemap.xml']) {
      const reply=await http(port,path); assert.equal(reply.status,404,path);
      assert.match(reply.body,/Page not found/); assert.doesNotMatch(reply.body,/<form/);
    }
    for (const method of ['POST','PUT','DELETE','OPTIONS']) {
      const reply=await http(port,'/index.html',method); assert.equal(reply.status,405); assert.equal(reply.headers.allow,'GET, HEAD');
    }
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
