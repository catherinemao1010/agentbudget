import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './index.js';
const memory=new Map();
let sequence=0;
const versions=new Map();
const env={BUCKET:{async get(k){const value=memory.get(k);return value?{etag:versions.get(k),json:async()=>JSON.parse(value)}:null;},async put(k,v,options={}){const condition=options.onlyIf;if(condition?.etagMatches && condition.etagMatches!==versions.get(k))return null;if(condition?.etagDoesNotMatch==='*'&&memory.has(k))return null;memory.set(k,v);versions.set(k,String(++sequence));return {etag:versions.get(k)};}}};
const run=(id,is_demo=false)=>({id,name:'Task',agent:'Tester',status:'completed',created_at:'2026-11-11T00:00:00Z',is_demo,budget_usd:1,spent_usd:0.02,reserved_usd:0,calls:[{id:'call',model:'model',status:'completed',created_at:'2026-11-11',pricing_version:'test',cost_usd:0.02,reserved_usd:0,input_tokens:100,output_tokens:50,cached_tokens:20,latency_ms:200}]});
const req=(path,body,user='alice',extra={})=>new Request('https://test.example'+path,{method:body?'POST':'GET',headers:{...(user?{'oai-authenticated-user-id':user}:{}),'Content-Type':'application/json',Origin:'https://test.example','X-AgentBudget-Client':'dashboard',...extra},...(body?{body:JSON.stringify(body)}:{})});
const rpc=async(name,args={},user='alice')=>(await handleRequest(req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}},user),env)).json();
test('discovery works without identity; tools are read-only',async()=>{const r=await handleRequest(req('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'},null),env);const d=await r.json();assert.equal(d.result.tools.length,4);assert.ok(d.result.tools.every(t=>t.annotations.readOnlyHint));});
test('sync isolates accounts, strips unknown fields, excludes demos by default, totals cached input once',async()=>{
  assert.equal((await handleRequest(req('/api/plugin/snapshot',{runs:[{...run('real'),secret:'do not store'},run('demo',true)]}),env)).status,200);
  const total=JSON.parse((await rpc('get_spend_summary')).result.content[0].text);assert.equal(total.total_tokens,150);assert.equal(total.estimated_cost_usd,0.02);
  const all=JSON.parse((await rpc('get_spend_summary',{include_demo:true})).result.content[0].text);assert.equal(all.total_tokens,300);
  const other=JSON.parse((await rpc('list_runs',{},'bob')).result.content[0].text);assert.deepEqual(other.runs,[]);
  assert.equal((await rpc('get_run_details',{run_id:'real'},'bob')).result.isError,true);
  assert.ok(!memory.get('snapshots/alice.json').includes('secret'));
});
test('missing identity and cross-origin uploads rejected',async()=>{assert.equal((await handleRequest(req('/api/plugin/status',null,null),env)).status,401);assert.equal((await handleRequest(req('/api/plugin/snapshot',{runs:[]},'alice',{Origin:'https://evil.test'}),env)).status,403);assert.equal((await rpc('get_spend_summary',{},null)).result.isError,true);});
test('reject invalid and duplicate records, malformed tool arguments',async()=>{for(const runs of [[run('x'),run('x')],[{...run('x'),spent_usd:-1}],[{...run('x'),is_demo:'false'}]])assert.equal((await handleRequest(req('/api/plugin/snapshot',{runs}),env)).status,400);assert.equal((await rpc('list_runs',{limit:10000})).result.isError,true);assert.equal((await rpc('get_spend_summary',{include_demo:'false'})).result.isError,true);});
test('sync replaces prior snapshot; no accumulation',async()=>{await handleRequest(req('/api/plugin/snapshot',{runs:[run('replacement')]}),env);const d=JSON.parse((await rpc('list_runs')).result.content[0].text);assert.equal(d.runs.length,1);assert.equal(d.runs[0].id,'replacement');});

test('automatic updates are visible on the very next plugin request without manual sync',async()=>{
  const r=await handleRequest(req('/api/plugin/changes',{upserts:[run('auto-1')],removed:[]},'automatic'),env);
  assert.equal(r.status,200);
  const summary=JSON.parse((await rpc('get_spend_summary',{},'automatic')).result.content[0].text);
  assert.equal(summary.run_count,1);assert.equal(summary.total_tokens,150);assert.ok(summary.read_at);
  const hydrated=await (await handleRequest(req('/api/plugin/snapshot',null,'automatic'),env)).json();assert.equal(hydrated.runs[0].id,'auto-1');
  await handleRequest(req('/api/plugin/changes',{upserts:[{...run('auto-1'),budget_usd:5}],removed:[]},'automatic'),env);
  const detail=JSON.parse((await rpc('get_run_details',{run_id:'auto-1'},'automatic')).result.content[0].text);assert.equal(detail.run.budget_usd,5);
});
test('concurrent auto-saves merge distinct runs and retries are idempotent',async()=>{
  const responses=await Promise.all(['a','b','c'].map(id=>handleRequest(req('/api/plugin/changes',{upserts:[run(id)],removed:[]},'concurrent'),env)));
  assert.ok(responses.every(r=>r.status===200));
  await handleRequest(req('/api/plugin/changes',{upserts:[run('b')],removed:[]},'concurrent'),env);
  const summary=JSON.parse((await rpc('get_spend_summary',{},'concurrent')).result.content[0].text);assert.equal(summary.run_count,3);
  await handleRequest(req('/api/plugin/changes',{upserts:[],removed:['b']},'concurrent'),env);
  assert.equal(JSON.parse((await rpc('get_spend_summary',{},'concurrent')).result.content[0].text).run_count,2);
});
test('auto-save authorization, isolation and validation',async()=>{
  assert.equal((await handleRequest(req('/api/plugin/changes',{upserts:[run('x')],removed:[]},null),env)).status,401);
  assert.equal((await handleRequest(req('/api/plugin/changes',{upserts:[run('x')],removed:[]},'auto',{Origin:'https://evil.test'}),env)).status,403);
  assert.equal((await handleRequest(req('/api/plugin/changes',{upserts:[run('x')],removed:['x']},'auto'),env)).status,400);
  assert.equal((await rpc('get_run_details',{run_id:'auto-1'},'other')).result.isError,true);
});
