const VERSION = '2026-07-28';
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const filter = { type: 'boolean', default: false, description: 'Include clearly labeled simulated demo usage.' };
const tool = (name, description, properties, required=[]) => ({name, description, annotations, inputSchema:{type:'object',properties,required,additionalProperties:false}});
const tools = [
  tool('get_spend_summary','Report USD cost estimates and input, output, cached and total tokens from the latest automatically saved AgentBudget records. Not provider billing or subscription usage.',{include_demo:filter}),
  tool('list_runs','List tracked tasks with their USD costs, tokens, budgets and outcomes from the latest saved records.',{include_demo:filter,limit:{type:'integer',minimum:1,maximum:100,default:20}}),
  tool('get_run_details','Read one tracked run, including model requests, USD costs, tokens and latency.',{run_id:{type:'string',minLength:1,maxLength:200}},['run_id']),
];
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail = (message,status=400) => { throw Object.assign(new Error(message),{status}); };
const str = (v,key) => typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : fail(`Invalid ${key}`);
const num = (v,key,integer=false) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e12 && (!integer || Number.isSafeInteger(v)) ? v : fail(`Invalid ${key}`);
function cleanRun(r) {
  if (!r || typeof r !== 'object' || typeof r.is_demo !== 'boolean' || !Array.isArray(r.calls) || r.calls.length>1000) fail('Invalid run');
  const out = {is_demo:r.is_demo};
  for (const k of ['id','name','agent','status','created_at']) out[k]=str(r[k],k);
  for (const k of ['spent_usd','reserved_usd','budget_usd']) out[k]=num(r[k],k);
  out.calls=r.calls.map(c=>{
    const call={};
    for (const k of ['id','model','status','created_at','pricing_version']) call[k]=str(c[k],k);
    for (const k of ['cost_usd','reserved_usd','latency_ms']) call[k]=num(c[k],k);
    for (const k of ['input_tokens','output_tokens','cached_tokens']) call[k]=num(c[k],k,true);
    if(call.cached_tokens>call.input_tokens) fail('Cached tokens exceed input tokens');
    return call;
  });
  return out;
}
const totals = runs => {
  const calls=runs.flatMap(r=>r.calls);
  const sum=(items,key)=>items.reduce((s,r)=>s+r[key],0);
  return {run_count:runs.length,request_count:calls.length,estimated_cost_usd:Math.round(sum(runs,'spent_usd')*1e9)/1e9,reserved_usd:sum(runs,'reserved_usd'),input_tokens:sum(calls,'input_tokens'),output_tokens:sum(calls,'output_tokens'),cached_tokens:sum(calls,'cached_tokens'),total_tokens:sum(calls,'input_tokens')+sum(calls,'output_tokens'),average_latency_ms:calls.length?sum(calls,'latency_ms')/calls.length:0};
};
async function snapshot(request,env) {
  const uid=request.headers.get('oai-authenticated-user-id');
  if(!uid) fail('Sign in to AgentBudget to access your records.',401);
  if(!env.BUCKET) fail('Snapshot storage is unavailable.',503);
  const key=`snapshots/${encodeURIComponent(uid)}.json`;
  const object=await env.BUCKET.get(key);
  return {key,data:await object?.json() || null,etag:object?.etag};
}
async function execute(request,env,name,args={}) {
  if(!tools.some(t=>t.name===name)) fail('Unknown tool');
  if(!args || typeof args!=='object' || Array.isArray(args)) fail('Invalid arguments');
  const allowed=Object.keys(tools.find(t=>t.name===name).inputSchema.properties);
  if(Object.keys(args).some(k=>!allowed.includes(k))) fail('Unknown argument');
  if(args.include_demo!==undefined && typeof args.include_demo!=='boolean') fail('include_demo must be boolean');
  const {data}=await snapshot(request,env);
  const meta={synced_at:data?.synced_at||null,source:'automatically saved dashboard records',read_at:new Date().toISOString(),cost_basis:'Reported estimates, not provider billing. Cached tokens are included in input tokens.',message:data?undefined:'No records yet. Open the AgentBudget dashboard while signed in; records save automatically.'};
  const runs=(data?.runs||[]).filter(r=>args.include_demo===true||!r.is_demo);
  if(name==='get_spend_summary') return {...meta,includes_demo:args.include_demo===true,...totals(runs)};
  if(name==='list_runs') {
    const limit=args.limit??20;
    if(!Number.isInteger(limit)||limit<1||limit>100) fail('limit must be 1–100');
    return {...meta,runs:runs.slice().sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,limit).map(({calls,...r})=>({...r,...totals([{...r,calls}])}))};
  }
  str(args.run_id,'run_id');
  const run=data?.runs.find(r=>r.id===args.run_id);
  if(!run) fail('Run not found in your latest saved records.');
  return {...meta,run,totals:totals([run])};
}
export async function handleRequest(request,env,assets={}) {
  const url=new URL(request.url);
  try {
    if(url.pathname==='/mcp') {
      if(request.method!=='POST') return json({error:'Use POST'},405);
      let rpc;
      try {rpc=await request.json();} catch {return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});}
      if(!rpc || rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string') return json({jsonrpc:'2.0',id:rpc?.id??null,error:{code:-32600,message:'Invalid Request'}});
      if(rpc.method.startsWith('notifications/')) return new Response(null,{status:202});
      let result;
      if(rpc.method==='server/discover') result={supportedVersions:[VERSION],capabilities:{tools:{}},serverInfo:{name:'AgentBudget',version:'0.2.0'}};
      else if(rpc.method==='initialize') result={protocolVersion:VERSION,capabilities:{tools:{}},serverInfo:{name:'AgentBudget',version:'0.2.0'}};
      else if(rpc.method==='ping') result={};
      else if(rpc.method==='tools/list') result={tools};
      else if(rpc.method==='tools/call') {
        try {result={content:[{type:'text',text:JSON.stringify(await execute(request,env,rpc.params?.name,rpc.params?.arguments))}]};}
        catch(e) {result={isError:true,content:[{type:'text',text:e.status?e.message:'Could not read your snapshot. Please try again.'}]};}
      } else return json({jsonrpc:'2.0',id:rpc.id??null,error:{code:-32601,message:'Method not found'}});
      return json({jsonrpc:'2.0',id:rpc.id??null,result});
    }
    if(url.pathname==='/api/plugin/snapshot' && request.method==='GET') {
      const {data}=await snapshot(request,env);
      return json({runs:data?.runs||[],synced_at:data?.synced_at||null});
    }
    if(url.pathname==='/api/plugin/changes' && request.method==='POST') {
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-AgentBudget-Client')!=='dashboard') fail('Invalid request origin',403);
      if(!request.headers.get('Content-Type')?.includes('application/json')) fail('Expected JSON',415);
      // Authenticate before reading client data.
      await snapshot(request,env);
      const raw=await request.text();
      if(raw.length>2000000) fail('Changes are too large (maximum 2 MB).',413);
      const body=JSON.parse(raw);
      if(!Array.isArray(body.upserts)||!Array.isArray(body.removed)||body.upserts.length>500||body.removed.length>500) fail('Invalid changes');
      const upserts=body.upserts.map(cleanRun), removed=body.removed.map(id=>str(id,'removed ID'));
      if(new Set(upserts.map(r=>r.id)).size!==upserts.length) fail('Duplicate run IDs');
      if(upserts.some(r=>removed.includes(r.id))) fail('Cannot update and remove the same run');
      for(let attempt=0;attempt<5;attempt++) {
        const {key,data,etag}=await snapshot(request,env);
        const merged=new Map((data?.runs||[]).map(r=>[r.id,r]));
        for(const id of removed) merged.delete(id);
        for(const run of upserts) merged.set(run.id,run);
        if(merged.size>500) fail('Maximum 500 saved runs');
        const next={runs:Array.from(merged.values()),synced_at:new Date().toISOString()};
        // Conditional writes prevent simultaneous tabs from discarding unrelated runs.
        const saved=await env.BUCKET.put(key,JSON.stringify(next),{onlyIf:etag?{etagMatches:etag}:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'}});
        if(saved) return json({synced_at:next.synced_at,run_count:next.runs.length});
      }
      fail('Another session is saving. Please retry.',409);
    }
    if(url.pathname==='/api/plugin/status' && request.method==='GET') {
      const {data}=await snapshot(request,env);
      return json({available:true,synced_at:data?.synced_at||null,run_count:data?.runs.length||0});
    }
    if(url.pathname==='/api/plugin/snapshot' && request.method==='POST') {
      if(request.headers.get('Origin')!==url.origin||request.headers.get('X-AgentBudget-Client')!=='dashboard') fail('Invalid request origin',403);
      if(!request.headers.get('Content-Type')?.includes('application/json')) fail('Expected JSON',415);
      const {key}=await snapshot(request,env);
      const raw=await request.text();
      if(raw.length>2000000) fail('Snapshot is too large (maximum 2 MB).',413);
      const body=JSON.parse(raw);
      if(!Array.isArray(body.runs)||body.runs.length>500) fail('Expected up to 500 runs');
      const runs=body.runs.map(cleanRun);
      if(new Set(runs.map(r=>r.id)).size!==runs.length) fail('Duplicate run IDs');
      const data={synced_at:new Date().toISOString(),runs};
      await env.BUCKET.put(key,JSON.stringify(data),{httpMetadata:{contentType:'application/json'}});
      return json({synced_at:data.synced_at,run_count:runs.length});
    }
    if(url.pathname.startsWith('/api/')) return json({detail:'The local ledger API runs on your computer. Use Integrations to sync a snapshot to this hosted plugin.'},404);
    if(request.method!=='GET'&&request.method!=='HEAD') return json({error:'Method not allowed'},405);
    const asset=assets[url.pathname] || (url.pathname==='/' ? assets['/index.html']:null);
    if(!asset) return new Response('Not found',{status:404});
    return new Response(request.method==='HEAD'?null:Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0)),{headers:{'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'}});
  } catch(e) {return json({error:e.status?e.message:'Request could not be processed.'},e.status||400);}
}
export default {fetch:handleRequest};
