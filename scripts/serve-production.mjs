import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PRODUCTION_ASSETS, PRODUCTION_DIRECTORY, verifyProduction, validateProduction, parseHeaderRules, modelHeaders } from './production-lib.mjs';

const MIME={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',txt:'text/plain; charset=utf-8',xml:'application/xml; charset=utf-8'};

export async function createProductionModel(input) {
  let files;
  if(input){ await validateProduction(input); files=new Map([...input].map(([path,data])=>[path,Buffer.from(data)])); }
  else {
    await verifyProduction();
    files=new Map(await Promise.all(PRODUCTION_ASSETS.map(async path=>[path,await readFile(join(PRODUCTION_DIRECTORY,path))])));
  }
  const rules=parseHeaderRules(files.get('_headers').toString('utf8'));
  return createServer((request,response)=>{
    const raw=request.url??'';
    const path=raw.split('?')[0];
    const valid=path.startsWith('/')&&!path.startsWith('//')&&!/[%#\\\x00]/.test(path);
    const asset=valid?path.slice(1):'';
    const found=asset!=='_headers'&&files.has(asset);
    const status=found&&asset!=='404.html'?200:404;
    const body=files.get(status===404?'404.html':asset);
    const headers=modelHeaders(rules,status===404?'/404.html':path);
    if(!['GET','HEAD'].includes(request.method)){
      request.resume();
      response.writeHead(405,{...modelHeaders(rules,'/404.html'),Allow:'GET, HEAD','Content-Type':'text/plain; charset=utf-8'});
      response.end('Method not allowed.'); return;
    }
    const extension=(status===404?'404.html':asset).split('.').at(-1);
    response.writeHead(status,{...headers,'Content-Type':MIME[extension],'Content-Length':body.length});
    response.end(request.method==='HEAD'?undefined:body);
  });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const server=await createProductionModel();
  server.once('error',error=>{
    process.stderr.write(error.code==='EADDRINUSE'?'Port 5211 is in use; existing services preserved.\n':'Production model failed to start.\n');
    process.exitCode=1;
  });
  server.listen(5211,'127.0.0.1',()=>process.stdout.write(`M2 local HTTP model: http://127.0.0.1:5211/index.html; PID ${process.pid}; not a Cloudflare deployment.\n`));
}
