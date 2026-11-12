// Current-rate scenarios, never a provider invoice or a fixed subscription token quota.
export const PRICING = {
  checked_at:'2026-11-12',
  api_source:'https://developers.openai.com/api/docs/pricing',
  subscription_source:'https://learn.chatgpt.com/docs/pricing',
  api:{'gpt-6-astra':[10,1,50],'gpt-6.1-sol':[2,.1,10],'gpt-6.1-terra':[1,.05,5],'gpt-6-sol':[2,.2,10],'gpt-6-luna':[.1,.01,.5],'gpt-5.6-sol':[4,.4,20]},
  credits:{'gpt-6-astra':[250,25,1250],'gpt-6.1-sol':[50,2.5,250],'gpt-6.1-terra':[25,1.25,125],'gpt-6-sol':[50,5,250],'gpt-6-luna':[2.5,.25,12.5],'gpt-5.6-sol':[100,10,500]},
  plans:[{id:'plus',name:'Plus',monthly_usd:20},{id:'pro100',name:'Pro $100',monthly_usd:100},{id:'pro200',name:'Pro $200',monthly_usd:200},{id:'pro500',name:'Pro $500',monthly_usd:500}]
};
const insightFail=message=>{throw Object.assign(new Error(message),{status:400});};
const insightNum=(v,max=1e12)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=max?v:insightFail('Invalid analytics number');
const insightDate=v=>typeof v==='string'&&v.length<=40&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():insightFail('Invalid analytics timestamp');
const insightKeys=['input_tokens','cached_tokens','output_tokens','reasoning_tokens','request_count','long_input_tokens','long_cached_tokens','long_output_tokens'];
function insightModels(rows){
  if(!Array.isArray(rows)||rows.length>100)insightFail('Invalid analytics models');
  const seen=new Set();
  return rows.map(m=>{
    if(typeof m.model!=='string'||!/^[\w.:-]{1,100}$/.test(m.model)||seen.has(m.model))insightFail('Invalid analytics model');seen.add(m.model);
    const row={model:m.model};for(const k of insightKeys){row[k]=insightNum(m[k]??0);if(!Number.isSafeInteger(row[k]))insightFail('Invalid analytics count');}
    if(row.cached_tokens>row.input_tokens||row.reasoning_tokens>row.output_tokens||row.long_input_tokens>row.input_tokens||row.long_cached_tokens>row.cached_tokens||row.long_cached_tokens>row.long_input_tokens||row.long_output_tokens>row.output_tokens)insightFail('Invalid analytics subsets');
    return row;
  });
}
export function insightsCleanAnalytics(a){
  if(a===undefined)return null;
  if(a?.version!==1||typeof a.timezone!=='string'||a.timezone.length>100||!Array.isArray(a.daily)||a.daily.length>32)insightFail('Invalid analytics');
  const daily=a.daily.map(d=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(d.date))insightFail('Invalid day');return {date:d.date,models:insightModels(d.models)};});
  if(new Set(daily.map(d=>d.date)).size!==daily.length)insightFail('Duplicate analytics day');
  const periods={};
  for(const key of ['today','last7','last30','since_reset_primary','since_reset_secondary'])if(a.periods?.[key]){
    const p=a.periods[key],start=insightDate(p.start),end=insightDate(p.end);if(end<start)insightFail('Invalid period');
    periods[key]={start,end,coverage_complete:p.coverage_complete===true,models:insightModels(p.models)};
  }
  let quota=null;
  if(a.quota){
    const q=a.quota;if(!Array.isArray(q.windows)||q.windows.length>2)insightFail('Invalid quota windows');
    quota={observed_at:insightDate(q.observed_at),plan_type:typeof q.plan_type==='string'&&q.plan_type.length<40?q.plan_type:'unknown',credit_balance:q.credit_balance==null?null:insightNum(q.credit_balance),unlimited_credits:q.unlimited_credits===true,
      windows:q.windows.map(w=>{
        if(!['primary','secondary'].includes(w.key))insightFail('Invalid quota key');
        return {key:w.key,used_percent:insightNum(w.used_percent,100),window_minutes:insightNum(w.window_minutes,525600),resets_at:insightDate(w.resets_at),started_at:insightDate(w.started_at),started_at_basis:w.started_at_basis==='reset time minus window duration'?w.started_at_basis:'first observed decrease; reset may have occurred earlier'};
      })};
    if(new Set(quota.windows.map(w=>w.key)).size!==quota.windows.length||quota.windows.some(w=>w.window_minutes<=0||w.started_at>=w.resets_at))insightFail('Invalid quota window');
  }
  return {version:1,timezone:a.timezone,history_start:a.history_start?insightDate(a.history_start):null,daily,periods,quota};
}
export function insightsCleanPreferences(p){
  const plan=id=>id==null||id===''?null:PRICING.plans.some(x=>x.id===id)?id:insightFail('Unknown plan');
  const optional=(v,max)=>v==null||v===''?null:insightNum(v,max);
  const out={current_plan:plan(p.current_plan),alternative_plan:plan(p.alternative_plan),credit_pack_usd:optional(p.credit_pack_usd,1000000),credit_pack_amount:optional(p.credit_pack_amount,1e9),alternative_allowance_multiple:optional(p.alternative_allowance_multiple,1000),monthly_api_budget:optional(p.monthly_api_budget,1e9),speed:p.speed||'standard'};
  if(!['standard','fast','ultrafast'].includes(out.speed))insightFail('Invalid speed');
  if(out.credit_pack_amount===0||out.alternative_allowance_multiple===0)insightFail('Amount must be positive');
  return out;
}
function insightEstimate(rows,speed='standard'){
  let tokens=0,api=0,credits=0;const missing=[];
  for(const m of rows){
    tokens+=m.input_tokens+m.output_tokens;
    const a=PRICING.api[m.model],c=PRICING.credits[m.model];if(!a||!c){missing.push(m.model);continue;}
    const uncached=m.input_tokens-m.cached_tokens;
    // The long-context surcharge applies to the full response, not only excess tokens.
    const longUncached=m.long_input_tokens-m.long_cached_tokens;
    api+=(uncached*a[0]+m.cached_tokens*a[1]+m.output_tokens*a[2]+longUncached*a[0]+m.long_cached_tokens*a[1]+m.long_output_tokens*a[2]*.5)/1e6;
    credits+=(uncached*c[0]+m.cached_tokens*c[1]+m.output_tokens*c[2])/1e6;
  }
  const multiple={standard:1,fast:2,ultrafast:6}[speed];
  return {total_tokens:tokens,api_equivalent_usd:missing.length?null:api*multiple,credit_equivalent:missing.length?null:credits*multiple,known_model_api_subtotal_usd:api*multiple,unpriced_models:[...new Set(missing)]};
}
export function buildInsights(a,p={},clock=Date.now()){
  const settings=insightsCleanPreferences(p);
  if(!a)return {available:false,settings,pricing:PRICING,message:'Update the local collector to enable daily usage, allowance, and estimates.'};
  const estimate=rows=>insightEstimate(rows,settings.speed);
  const periods=Object.fromEntries(Object.entries(a.periods).map(([k,v])=>[k,{...v,...estimate(v.models)}]));
  const daily=a.daily.map(d=>({...d,...estimate(d.models)}));
  const q=a.quota;
  const windows=(q?.windows||[]).map(w=>{
    const observed=Date.parse(q.observed_at),start=Date.parse(w.started_at),reset=Date.parse(w.resets_at);
    const fresh=clock-observed<3600000&&observed<=clock+60000&&reset>clock;
    const elapsed=(observed-start)/86400000;
    const pace=elapsed>=.25&&w.used_percent>0?w.used_percent/elapsed:null;
    const days=pace?(100-w.used_percent)/pace:null;
    const exhaustion=days===null?null:observed+days*86400000;
    const projected=pace?pace*(reset-start)/86400000:null;
    const result=!fresh?'stale':w.used_percent>=100?'exhausted':pace===null?'insufficient_history':exhaustion>=reset?'reset_first':'runs_out_before_reset';
    return {...w,remaining_percent:100-w.used_percent,fresh,percent_per_day:pace,projected_window_used_percent:projected,forecast:result,exhausts_at:fresh&&exhaustion!==null&&exhaustion<reset?new Date(exhaustion).toISOString():null};
  });
  const observedPeriod=periods.last7;
  const reliable=observedPeriod?.coverage_complete===true;
  const monthlyApi=reliable&&observedPeriod.api_equivalent_usd!==null?observedPeriod.api_equivalent_usd*30/7:null;
  const monthlyCredits=reliable&&observedPeriod.credit_equivalent!==null?observedPeriod.credit_equivalent*30/7:null;
  const usdPerCredit=settings.credit_pack_usd!==null&&settings.credit_pack_amount?settings.credit_pack_usd/settings.credit_pack_amount:null;
  const current=PRICING.plans.find(v=>v.id===settings.current_plan),alternative=PRICING.plans.find(v=>v.id===settings.alternative_plan);
  const planMatches=!current||!q||q.plan_type==='unknown'||(current.id.startsWith('pro')?q.plan_type.startsWith('pro'):q.plan_type===current.id);
  const quotaReliable=planMatches&&windows.length>0&&windows.every(w=>w.fresh&&w.projected_window_used_percent!==null);
  const projectedPct=quotaReliable?Math.max(...windows.map(w=>w.projected_window_used_percent)):null;
  const scenario=(plan,multiple)=>{
    if(!plan)return null;
    const overage=projectedPct!==null&&monthlyCredits!==null&&multiple?monthlyCredits*Math.max(0,1-100*multiple/projectedPct):null;
    const additional=overage===0?0:overage!==null&&usdPerCredit!==null?overage*usdPerCredit:null;
    return {plan:plan.name,monthly_subscription_usd:plan.monthly_usd,allowance_multiple:multiple,monthly_top_up_credits:overage,monthly_top_up_usd:additional,monthly_total_usd:additional===null?null:plan.monthly_usd+additional};
  };
  const currentScenario=scenario(current,1),alternativeScenario=scenario(alternative,settings.alternative_allowance_multiple);
  let recommendation='Choose your current plan and enter your credit-pack price to compare costs.';
  if(!reliable)recommendation='A full seven days of local history is needed for a monthly projection.';
  else if(!planMatches)recommendation='The selected current plan does not match the plan reported by Codex. Select your actual billed plan before comparing.';
  else if(!quotaReliable)recommendation='Waiting for a fresh Codex allowance reading and at least six hours of the current window.';
  else if(currentScenario?.monthly_total_usd!=null&&alternativeScenario?.monthly_total_usd!=null){
    const cheaper=currentScenario.monthly_total_usd<=alternativeScenario.monthly_total_usd?currentScenario:alternativeScenario;
    recommendation=cheaper.plan+' has the lower modeled monthly cost under your allowance and speed assumptions.';
  } else if(currentScenario?.monthly_top_up_credits===0)recommendation='Your current plan is on pace to reset before its allowance runs out. Extra credits or an upgrade are not indicated by this pace.';
  else if(currentScenario)recommendation='Compare your current plan plus projected top-ups with an alternative. Enter that plan’s allowance multiple; price alone does not establish its capacity.';
  return {available:true,timezone:a.timezone,history_start:a.history_start,periods,daily,settings,pricing:PRICING,
    quota:q?{...q,windows,token_balance:null,token_balance_reason:'Codex reports allowance percentages, not a fixed number of remaining tokens.'}:null,
    comparison:{basis:'Last 7 complete local calendar days projected to 30 days. Same model mix and selected speed; estimates, not invoices.',monthly_api_equivalent_usd:monthlyApi,monthly_credit_equivalent:monthlyCredits,usd_per_credit:usdPerCredit,current:currentScenario,alternative:alternativeScenario,recommendation,
      api_vs_subscription:monthlyApi!==null&&currentScenario?.monthly_total_usd!=null?(monthlyApi<currentScenario.monthly_total_usd?'API pay-as-you-go has the lower modeled compute cost. It does not include the same subscription features.':'The selected subscription plus modeled top-ups costs less than the API-equivalent workload.'):'API and subscription totals need complete history and the selected plan assumptions before comparison.',
      credit_balance:q?.credit_balance??null,credit_runway_days:monthlyCredits>0&&q?.credit_balance!=null&&clock-Date.parse(q.observed_at)<3600000&&Date.parse(q.observed_at)<=clock+60000?q.credit_balance/(monthlyCredits/30):null,
      api_budget_runway_days:monthlyApi>0&&settings.monthly_api_budget!=null?settings.monthly_api_budget/(monthlyApi/30):null},
    caveats:['Prices checked 2026-11-12; verify current offers and taxes before changing plans.','API estimates use selected speed, cached-input discounts and long-context surcharges. They exclude cache writes, tools, images, regional charges and negotiated discounts.','Credit estimates use published standard token rates times the selected speed multiplier; model-specific surcharges may differ.','Subscription top-ups are a scenario based on observed percentage pace and local token mix. Shared usage on other devices can change the result.','Alternative plan capacity is user supplied. No fixed subscription token allowance is assumed.']};
}
