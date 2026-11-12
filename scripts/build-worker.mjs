import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
const assets={};
async function walk(dir,prefix='') {
  for(const file of await readdir(dir,{withFileTypes:true})) {
    if(file.name==='server'||file.name==='.openai') continue;
    const path=`${dir}/${file.name}`,url=`${prefix}/${file.name}`;
    if(file.isDirectory()) await walk(path,url);
    else assets[url]={body:(await readFile(path)).toString('base64'),type:({'html':'text/html; charset=utf-8','js':'text/javascript; charset=utf-8','css':'text/css; charset=utf-8','svg':'image/svg+xml','png':'image/png'})[file.name.split('.').at(-1)]||'application/octet-stream'};
  }
}
await walk('dist');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const worker=(await readFile('worker/index.js','utf8')).replace('export default {fetch:handleRequest};',`const assets=${JSON.stringify(assets)};\nexport default {fetch:(request,env)=>handleRequest(request,env,assets)};`);
await writeFile('dist/server/index.js',worker);
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log('Built embedded dashboard + MCP Worker');
