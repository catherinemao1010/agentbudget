// Write-only, revocable device credentials. Session text never enters this API.
const response = (body, status=200) => Response.json(body, {status, headers:{'Cache-Control':'no-store'}});
const reject = (message, status=400) => {throw Object.assign(new Error(message), {status});};
const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b=>b.toString(16).padStart(2,'0')).join('');
const identity = request => request.headers.get('oai-authenticated-user-id') || reject('Sign in to connect your collector.',401);
const userKey = uid => encodeURIComponent(uid);
const read = async (env,key) => (await env.BUCKET.get(key))?.json();
const timestamp = value => typeof value==='string' && value.length<=40 && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : reject('Invalid timestamp');
const count = value => Number.isSafeInteger(value) && value>=0 && value<=1e12 ? value : reject('Invalid token count');
const label = value => typeof value==='string' && /^[a-zA-Z0-9_.: ()/-]{1,100}$/.test(value) ? value : reject('Invalid identifier');
const fields=['input_tokens','cached_tokens','output_tokens','reasoning_tokens','request_count'];
const blank = () => Object.fromEntries(fields.map(k=>[k,0]));
function cleanUsage(body) {
  if(body?.schema_version!==1 || !Array.isArray(body.sessions) || body.sessions.length>2000) reject('Expected up to 2000 sessions');
  const seen=new Set();
  const sessions=body.sessions.map(s=>{
    const id=label(s.id);if(seen.has(id))reject('Duplicate session');seen.add(id);
    if(!Array.isArray(s.models)||s.models.length>100)reject('Invalid models');
    const names=new Set();
    return {id,started_at:timestamp(s.started_at),last_event_at:timestamp(s.last_event_at),models:s.models.map(m=>{
      const model=label(m.model);if(names.has(model))reject('Duplicate model');names.add(model);
      const out={model,...Object.fromEntries(fields.map(k=>[k,count(m[k])]))};
      if(out.cached_tokens>out.input_tokens||out.reasoning_tokens>out.output_tokens)reject('Invalid token subsets');
      return out;
    })};
  });
  return {schema_version:1,device_id:label(body.device_id),observed_at:timestamp(body.observed_at),sessions};
}
export async function readCollectorSummary(request,env) {
  const uid=identity(request);
  const data=await read(env,`usage/${userKey(uid)}.json`);
  const connection=await read(env,`collectors/${userKey(uid)}.json`);
  const byModel=new Map(),total=blank();
  for(const s of data?.sessions||[])for(const m of s.models){
    const row=byModel.get(m.model)||{model:m.model,...blank()};
    for(const k of fields){total[k]+=m[k];row[k]+=m[k];}byModel.set(m.model,row);
  }
  return {connected:!!connection?.hash,received_at:data?.received_at||null,observed_at:data?.observed_at||null,
    session_count:data?.sessions.length||0,...total,total_tokens:total.input_tokens+total.output_tokens,
    models:[...byModel.values()],cost_usd:null,
    source:'Codex local session usage records',scope:'Codex activity recorded on the connected Mac; excludes ordinary ChatGPT web chats and other devices.',
    cost_basis:'Token counts are recorded usage. Subscription billing and per-request prices are not exposed; cost is unavailable, not zero. Cached tokens are included in input; reasoning tokens are included in output.'};
}
export async function handleCollector(request,env) {
  const path=new URL(request.url).pathname;
  if(!path.startsWith('/api/collector/'))return null;
  if(!env.BUCKET)reject('Usage storage unavailable',503);
  if(path==='/api/collector/usage'&&request.method==='GET')return response(await readCollectorSummary(request,env));
  if(path==='/api/collector/connection'&&['POST','DELETE'].includes(request.method)){
    const uid=identity(request);
    if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-AgentBudget-Client')!=='dashboard')reject('Invalid origin',403);
    const key=`collectors/${userKey(uid)}.json`;
    if(request.method==='DELETE'){
      await env.BUCKET.put(key,JSON.stringify({hash:null}));return response({connected:false});
    }
    const token='ab_'+Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
    const digest=await hash(token);
    await env.BUCKET.put(`collector-keys/${digest}.json`,JSON.stringify({uid}));
    await env.BUCKET.put(key,JSON.stringify({hash:digest,created_at:new Date().toISOString()}));
    return response({token,scope:'Write Codex usage only. Creating a new key revokes the previous one.'});
  }
  if(path==='/api/collector/usage'&&request.method==='POST'){
    const token=request.headers.get('Authorization')?.replace(/^Bearer /,'');
    if(!token||!/^ab_[a-f0-9]{64}$/.test(token))reject('Collector key required',401);
    const digest=await hash(token),owner=await read(env,`collector-keys/${digest}.json`);
    if(!owner)reject('Invalid collector key',401);
    const connection=await read(env,`collectors/${userKey(owner.uid)}.json`);
    if(connection?.hash!==digest)reject('Collector key revoked',401);
    const raw=await request.text();if(raw.length>2000000)reject('Usage payload too large',413);
    const data=cleanUsage(JSON.parse(raw));
    // One active collector per account. Serialize snapshots with an ETag lease;
    // stale retries cannot roll newer observations backwards.
    const key=`usage/${userKey(owner.uid)}.json`;
    for(let attempt=0;attempt<5;attempt++){
      const object=await env.BUCKET.get(key),old=await object?.json();
      if(old?.observed_at>data.observed_at)return response({accepted:false,reason:'stale snapshot'});
      const next={...data,received_at:new Date().toISOString()};
      if(await env.BUCKET.put(key,JSON.stringify(next),{onlyIf:object?.etag?{etagMatches:object.etag}:{etagDoesNotMatch:'*'}}))return response({accepted:true,received_at:next.received_at,session_count:next.sessions.length});
    }
    reject('Usage update conflict; retry',409);
  }
  return response({error:'Not found'},404);
}
