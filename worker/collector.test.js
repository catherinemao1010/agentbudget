import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './index.js';
function setup(){
 const memory=new Map();let seq=0;
 const env={BUCKET:{async get(key){const item=memory.get(key);return item?{etag:item.etag,json:async()=>JSON.parse(item.value)}:null;},async put(key,value,options={}){const old=memory.get(key);if(options.onlyIf?.etagMatches&&old?.etag!==options.onlyIf.etagMatches)return null;if(options.onlyIf?.etagDoesNotMatch==='*'&&old)return null;const item={value,etag:String(++seq)};memory.set(key,item);return item;}}};
 const req=(path,method='GET',body,user='alice',token,origin='https://test.example')=>new Request('https://test.example'+path,{method,headers:{...(user?{'oai-authenticated-user-id':user}:{}),...(token?{Authorization:'Bearer '+token}:{}),Origin:origin,'X-AgentBudget-Client':'dashboard','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const call=(...args)=>handleRequest(req(...args),env);
 return {memory,call};
}
const payload=(time='2026-11-11T00:00:00Z')=>({schema_version:1,device_id:'device',observed_at:time,sessions:[{id:'hashed-session',started_at:time,last_event_at:time,prompt:'MUST NOT STORE',models:[{model:'gpt-test',input_tokens:100,cached_tokens:50,output_tokens:30,reasoning_tokens:10,request_count:1}]}]});
test('authenticated pairing, write-only key, isolated reads, no transcript persistence',async()=>{
 const {call,memory}=setup();
 assert.equal((await call('/api/collector/connection','POST',{},null)).status,401);
 assert.equal((await call('/api/collector/connection','POST',{},'alice',null,'https://evil.test')).status,403);
 const {token}=await (await call('/api/collector/connection','POST')).json();
 assert.equal((await call('/api/collector/usage','POST',payload(),null,token)).status,200);
 assert.equal((await call('/api/collector/usage','GET',null,null,token)).status,401);
 const data=await (await call('/api/collector/usage')).json();
 assert.equal(data.total_tokens,130);assert.equal(data.cached_tokens,50);assert.equal(data.reasoning_tokens,10);assert.equal(data.cost_usd,null);
 assert.equal((await (await call('/api/collector/usage','GET',null,'bob')).json()).total_tokens,0);
 assert.ok(!JSON.stringify([...memory.values()]).includes(token));assert.ok(!JSON.stringify([...memory.values()]).includes('MUST NOT STORE'));
 const rpc=await (await call('/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'get_spend_summary',arguments:{}}})).json();
 const summary=JSON.parse(rpc.result.content[0].text);assert.equal(summary.total_tokens,130);assert.equal(summary.estimated_cost_usd,null);assert.equal(summary.codex_usage.request_count,1);
});
test('repeated snapshot idempotence, stale retries, key rotation and revocation',async()=>{
 const {call}=setup();const key=await (await call('/api/collector/connection','POST')).json();
 for(let i=0;i<2;i++)assert.equal((await call('/api/collector/usage','POST',payload('2026-11-11T01:00:00Z'),null,key.token)).status,200);
 assert.equal((await (await call('/api/collector/usage')).json()).request_count,1);
 assert.equal((await (await call('/api/collector/usage','POST',payload(),null,key.token)).json()).accepted,false);
 const next=await (await call('/api/collector/connection','POST')).json();
 assert.equal((await call('/api/collector/usage','POST',payload(),null,key.token)).status,401);
 await call('/api/collector/connection','DELETE');
 assert.equal((await call('/api/collector/usage','POST',payload(),null,next.token)).status,401);
 assert.equal((await (await call('/api/collector/usage')).json()).total_tokens,130);
});
test('malformed counts, duplicate models and anonymous uploads rejected',async()=>{
 const {call}=setup();const {token}=await (await call('/api/collector/connection','POST')).json();
 assert.equal((await call('/api/collector/usage','POST',payload(),null)).status,401);
 const bad=payload();bad.sessions[0].models[0].cached_tokens=101;
 assert.equal((await call('/api/collector/usage','POST',bad,null,token)).status,400);
 const dup=payload();dup.sessions[0].models.push(dup.sessions[0].models[0]);
 assert.equal((await call('/api/collector/usage','POST',dup,null,token)).status,400);
});
