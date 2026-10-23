import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist');
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.png':'image/png','.svg':'image/svg+xml','.txt':'text/plain'};
const port=Number(process.env.PORT||4173);
http.createServer((req,res)=>{let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}const target=path.resolve(root,'.'+pathname+(pathname.endsWith('/')?'index.html':''));if(!target.startsWith(root+path.sep)&&target!==root){res.writeHead(403).end();return;}fs.readFile(target,(error,data)=>{if(error){res.writeHead(404).end('Not found');return;}res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});}).listen(port,'127.0.0.1',()=>console.log(`Local: http://127.0.0.1:${port}`));
