import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root=path.dirname(fileURLToPath(import.meta.url));
const live2d=await build({entryPoints:[path.join(root,'src/live2d-runtime.js')],bundle:true,write:false,format:'iife',globalName:'NoirLive2DRuntime',minify:true,legalComments:'inline'});
const live2dCode=live2d.outputFiles[0].text;
await writeFile(path.join(root,'dist/vendor/live2d-renderer.js'),live2dCode);
const worker=await build({entryPoints:[path.join(root,'dist/engine-worker.js')],bundle:true,write:false,format:'iife',minify:true,legalComments:'inline'});
const workerCode=worker.outputFiles[0].text;
const application=await readFile(path.join(root,'dist/app.js'),'utf8');
const source=`const embeddedWorkerURL=URL.createObjectURL(new Blob([${JSON.stringify(workerCode)}],{type:'text/javascript'}));\n`+application.replace("new Worker('./engine-worker.js',{type:'module'})",'new Worker(embeddedWorkerURL)');
const app=await build({stdin:{contents:source,resolveDir:path.join(root,'dist'),sourcefile:'app.js'},bundle:true,write:false,format:'iife',minify:true,legalComments:'inline'});
const css=await readFile(path.join(root,'dist/style.css'),'utf8');
const image=await readFile(path.join(root,'dist/assets/companion.png'));
const licenses=await Promise.all(['THREE-LICENSE.txt','CHESS-LICENSE.txt','PIXI-LICENSE.txt','LIVE2D-LICENSE.txt'].map(async name=>`${name}\n${await readFile(path.join(root,'dist/vendor',name),'utf8')}`));
let html=await readFile(path.join(root,'dist/index.html'),'utf8');
html=html.replace('<head>',()=>`<head>\n<script type="text/plain" id="third-party-licenses">${licenses.join('\n\n').replace(/<\/script/gi,'<\\/script')}</script>`)
  .replace('<link rel="stylesheet" href="./style.css">',()=>`<style>${css}</style>`)
  .replace(/\s*<script type="importmap">.*?<\/script>/s,'')
  .replace('src="./assets/companion.png"',()=>`src="data:image/png;base64,${image.toString('base64')}"`)
  .replace('<script type="module" src="./app.js"></script>',()=>`<script type="text/plain" id="embedded-live2d-renderer">${live2dCode.replace(/<\/script/gi,'<\\/script')}</script>\n<script>${app.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`);
const output=path.resolve(root,process.argv[2]||'dist/standalone.html');
await writeFile(output,html);
console.log(`Standalone game: ${output} (${Buffer.byteLength(html)} bytes)`);
