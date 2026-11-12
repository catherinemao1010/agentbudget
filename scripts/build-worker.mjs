import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
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
assets['/downloads/agentbudget-collector.py']={body:(await readFile('scripts/codex-collector.py')).toString('base64'),type:'text/x-python; charset=utf-8'};
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
const insights=(await readFile('worker/insights.js','utf8')).replace(/^export /gm,'');
const collector=(await readFile('worker/collector.js','utf8')).replace("import {buildInsights, insightsCleanAnalytics, insightsCleanPreferences} from './insights.js';",()=>insights).replaceAll('export async function','async function');
const worker=(await readFile('worker/index.js','utf8')).replace("import {handleCollector, readCollectorSummary} from './collector.js';",()=>collector).replace('export default {fetch:handleRequest};',()=>`const assets=${JSON.stringify(assets)};\nexport default {fetch:(request,env)=>handleRequest(request,env,assets)};`);
await writeFile('dist/server/index.js',worker);
// Validate the packaged module, not just the source modules, before publishing.
const syntax=spawnSync(process.execPath,['--check','dist/server/index.js'],{stdio:'inherit'});
if(syntax.status!==0)throw new Error('Embedded Worker syntax validation failed');
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
console.log('Built embedded dashboard + MCP Worker');
