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
function insightReport({windows,current,alternative,projectedPct,reliable,planMatches,settings},clock,timezone){
  let formatter;
  try{formatter=new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}catch{timezone='UTC';formatter=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'});}
  const date=v=>formatter.format(new Date(v));
  const duration=hours=>{
    const total=Math.max(0,Math.round(hours));
    if(total<1)return 'less than an hour';
    const days=Math.floor(total/24),rest=total%24;
    return [days?days+' day'+(days===1?'':'s'):'',rest?rest+' hour'+(rest===1?'':'s'):''].filter(Boolean).join(' ');
  };
  const forecasts=windows.map(w=>{
    const hours=w.fresh&&w.exhausts_at?Math.max(0,(Date.parse(w.exhausts_at)-clock)/3600000):w.forecast==='exhausted'?0:null;
    const windowName=w.window_minutes>=1440?(w.window_minutes/1440)+'-day':(w.window_minutes/60)+'-hour';
    const reset=date(w.resets_at);
    let text='There is not enough usage history yet to forecast this allowance.';
    if(w.forecast==='stale')text='The quota reading is stale; the time-to-exhaustion forecast is unavailable until it refreshes.';
    else if(w.forecast==='exhausted')text='Your '+windowName+' included allowance is exhausted. It resets '+reset+'.';
    else if(w.forecast==='runs_out_before_reset')text='At the same pace, your '+windowName+' included allowance will run out in about '+duration(hours)+' ('+date(w.exhausts_at)+'), before the reset on '+reset+'.';
    else if(w.forecast==='reset_first')text='At the same pace, your '+windowName+' included allowance should last until it resets '+reset+'; it is not projected to run out first.';
    return {window:w.key,status:w.forecast,remaining_percent:w.remaining_percent,hours_remaining:hours,exhausts_at:w.exhausts_at,resets_at:w.resets_at,text};
  });
  const active=forecasts.filter(w=>w.hours_remaining!==null).sort((a,b)=>a.hours_remaining-b.hours_remaining);
  const selected=active[0]||forecasts.find(w=>w.status==='stale'||w.status==='insufficient_history')||forecasts[0];
  const runway=selected||{status:'unavailable',hours_remaining:null,exhausts_at:null,text:'No Codex allowance reading is available yet.'};
  const cheaperOptions=current?PRICING.plans.filter(p=>p.monthly_usd<current.monthly_subscription_usd).map(p=>({id:p.id,name:p.name,monthly_usd:p.monthly_usd})):[];
  const minimum=projectedPct===null?null:projectedPct/100;
  const cheaper={status:'needs_details',text:'Cannot determine whether a cheaper plan is better yet.',monthly_savings_usd:null,minimum_allowance_multiple_to_avoid_topups:minimum,lower_priced_plans:cheaperOptions,missing_inputs:[]};
  if(!current){cheaper.missing_inputs.push('current subscription price tier');cheaper.text+=' Confirm your exact subscription tier once.';}
  else if(!planMatches){cheaper.status='plan_mismatch';cheaper.text='Your saved tier does not match the detected plan. Update it before judging a downgrade.';}
  else if(!reliable||projectedPct===null){cheaper.status='insufficient_data';cheaper.text='A cheaper-plan verdict needs complete recent usage history and a fresh allowance forecast.';}
  else if(!cheaperOptions.length){cheaper.status='lowest_modeled_tier';cheaper.text='Your current plan is already the lowest-priced subscription in this comparison. Free and Go are not modeled.';}
  else if(!alternative||alternative.monthly_subscription_usd>=current.monthly_subscription_usd){cheaper.missing_inputs.push('a lower-priced alternative and its verified allowance');cheaper.text='Choose a lower-priced plan to compare. Its subscription fee alone does not establish whether it will save money after top-ups.';}
  else if(!settings.alternative_allowance_multiple){cheaper.missing_inputs.push('alternative allowance relative to current plan');cheaper.text='The alternative has a lower subscription fee, but its allowance is needed to estimate top-ups and total savings.';}
  else if(current.monthly_total_usd===null||alternative.monthly_total_usd===null){cheaper.missing_inputs.push('credit-pack purchase price and amount');cheaper.text='This comparison includes estimated top-ups. Enter your credit-pack offer once to compare total costs.';}
  else{
    const savings=current.monthly_total_usd-alternative.monthly_total_usd;
    cheaper.monthly_savings_usd=savings;
    cheaper.status=savings>.005?'cheaper_plan_saves':savings<-.005?'keep_current':'no_material_savings';
    const money=n=>'$'+n.toFixed(2);
    cheaper.text=savings>.005?alternative.plan+' is cheaper by about '+money(savings)+'/month at this pace ('+money(alternative.monthly_total_usd)+' vs '+money(current.monthly_total_usd)+', including modeled top-ups).':savings<-.005?'Keep '+current.plan+' under these assumptions: '+alternative.plan+' has a lower subscription fee but costs about '+money(-savings)+'/month more after modeled top-ups.':'The lower-priced plan has no material modeled savings after top-ups.';
    if(alternative.monthly_top_up_credits>0)cheaper.text+=' Its included allowance alone would not cover this pace.';
  }
  if(minimum!==null&&minimum>1&&cheaper.status==='needs_details')cheaper.text+=' Your current pace exceeds your current included allowance, so a plan with less allowance would also need top-ups.';
  return {generated_at:new Date(clock).toISOString(),timezone,runway,allowance_windows:forecasts,cheaper_plan:cheaper,assumption:'Same average usage pace over the reported window. This forecasts included allowance, not when paid credits or all access will end. Plan costs use saved assumptions and published USD list prices; feature differences may matter.'};
}
export function buildInsights(a,p={},clock=Date.now()){
  const settings=insightsCleanPreferences(p);
  if(!a)return {available:false,report:{runway:{status:'unavailable',text:'Connect or update the collector for an allowance forecast.'},cheaper_plan:{status:'unavailable',text:'Usage and billing details are needed for a cheaper-plan comparison.'}},settings,pricing:PRICING,message:'Update the local collector to enable daily usage, allowance, and estimates.'};
  const estimate=rows=>insightEstimate(rows,settings.speed);
  const periods=Object.fromEntries(Object.entries(a.periods).map(([k,v])=>[k,{...v,...estimate(v.models)}]));
  const daily=a.daily.map(d=>({...d,...estimate(d.models)}));
  const q=a.quota;
  const planReadingFresh=!!q&&clock-Date.parse(q.observed_at)<3600000&&Date.parse(q.observed_at)<=clock+60000;
  // The usage feed identifies a plan family, not an invoice or Pro price tier.
  // Keep automatic defaults separate from saved user choices so they follow
  // later plan changes and never turn an inferred list price into a paid price.
  const automaticPlan=planReadingFresh&&q.plan_type==='plus'?'plus':null;
  const effectivePlan=settings.current_plan||automaticPlan;
  const creditPriceSaved=settings.credit_pack_usd!==null&&settings.credit_pack_amount!==null;
  const billingDetection={
    reported_plan:q?.plan_type||null,observed_at:q?.observed_at||null,fresh:planReadingFresh,
    automatic_plan:automaticPlan,effective_plan:effectivePlan,
    plan_source:settings.current_plan?'saved_selection':automaticPlan?'codex_reported_family':'unavailable',
    subscription_price_source:effectivePlan?'published_usd_list_price':'unavailable',
    credit_price_source:creditPriceSaved?'saved_user_offer':'unavailable',
    plan_message:!q?'Waiting for a Codex plan reading.':!planReadingFresh?'The last plan reading is stale. Use Codex to refresh automatic detection.':q.plan_type==='pro'?'Pro detected automatically. Codex does not report whether this is the $100, $200 or $500 tier. Choose your billed tier once.':automaticPlan?'Plus detected automatically. The comparison uses its published $20/month USD list price, not an invoice.':'Codex reports '+q.plan_type+'. This plan is not in the individual subscription comparison.',
    credit_message:creditPriceSaved?'Using your saved credit-pack offer. Update it only if your purchase price changes.':'Codex reports the credit balance, but not the purchase price. Enter an offer once; it is saved privately for future comparisons.'
  };
  if(planReadingFresh&&q.plan_type==='pro'&&settings.current_plan?.startsWith('pro'))billingDetection.plan_message='Pro detected automatically. Using your saved '+PRICING.plans.find(v=>v.id===settings.current_plan).name+' tier; change it only if your subscription changes.';
  const windows=(q?.windows||[]).map(w=>{
    const observed=Date.parse(q.observed_at),start=Date.parse(w.started_at),reset=Date.parse(w.resets_at);
    const fresh=clock-observed<3600000&&observed<=clock+60000&&reset>clock;
    const elapsed=(observed-start)/86400000;
    const minimumElapsedMs=Math.min(6*3600000,w.window_minutes*60000*.2);
    const pace=observed-start>=minimumElapsedMs&&w.used_percent>0?w.used_percent/elapsed:null;
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
  const current=PRICING.plans.find(v=>v.id===effectivePlan),alternative=PRICING.plans.find(v=>v.id===settings.alternative_plan);
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
  else if(!quotaReliable)recommendation='Waiting for a fresh Codex allowance reading and enough history in the current window.';
  else if(!current&&q?.plan_type==='pro')recommendation='Pro is detected. Choose your billed Pro tier once; the usage feed does not include its price.';
  else if(currentScenario?.monthly_total_usd!=null&&alternativeScenario?.monthly_total_usd!=null){
    const cheaper=currentScenario.monthly_total_usd<=alternativeScenario.monthly_total_usd?currentScenario:alternativeScenario;
    recommendation=cheaper.plan+' has the lower modeled monthly cost under your allowance and speed assumptions.';
  } else if(currentScenario?.monthly_top_up_credits===0)recommendation='Your current plan is on pace to reset before its allowance runs out. Extra credits or an upgrade are not indicated by this pace.';
  else if(currentScenario)recommendation='Compare your current plan plus projected top-ups with an alternative. Enter that plan’s allowance multiple; price alone does not establish its capacity.';
  const report=insightReport({windows,current:currentScenario,alternative:alternativeScenario,projectedPct,reliable,planMatches,settings},clock,a.timezone);
  return {available:true,report,timezone:a.timezone,history_start:a.history_start,periods,daily,settings,billing_detection:billingDetection,pricing:PRICING,
    quota:q?{...q,windows,token_balance:null,token_balance_reason:'Codex reports allowance percentages, not a fixed number of remaining tokens.'}:null,
    comparison:{basis:'Last 7 complete local calendar days projected to 30 days. Same model mix and selected speed; estimates, not invoices.',monthly_api_equivalent_usd:monthlyApi,monthly_credit_equivalent:monthlyCredits,usd_per_credit:usdPerCredit,current:currentScenario,alternative:alternativeScenario,recommendation,
      api_vs_subscription:monthlyApi!==null&&currentScenario?.monthly_total_usd!=null?(monthlyApi<currentScenario.monthly_total_usd?'API pay-as-you-go has the lower modeled compute cost. It does not include the same subscription features.':'The selected subscription plus modeled top-ups costs less than the API-equivalent workload.'):'API and subscription totals need complete history and the selected plan assumptions before comparison.',
      credit_balance:q?.credit_balance??null,credit_runway_days:monthlyCredits>0&&q?.credit_balance!=null&&clock-Date.parse(q.observed_at)<3600000&&Date.parse(q.observed_at)<=clock+60000?q.credit_balance/(monthlyCredits/30):null,
      api_budget_runway_days:monthlyApi>0&&settings.monthly_api_budget!=null?settings.monthly_api_budget/(monthlyApi/30):null},
    caveats:['Prices checked 2026-11-12; verify current offers and taxes before changing plans.','API estimates use selected speed, cached-input discounts and long-context surcharges. They exclude cache writes, tools, images, regional charges and negotiated discounts.','Credit estimates use published standard token rates times the selected speed multiplier; model-specific surcharges may differ.','Subscription top-ups are a scenario based on observed percentage pace and local token mix. Shared usage on other devices can change the result.','Alternative plan capacity is user supplied. No fixed subscription token allowance is assumed.']};
}
