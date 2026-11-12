import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildInsights,insightsCleanAnalytics,insightsCleanPreferences} from './insights.js';
const clock=Date.parse('2026-11-12T12:00:00Z');
const model={model:'gpt-6.1-sol',input_tokens:1000000,cached_tokens:800000,output_tokens:100000,reasoning_tokens:30000,request_count:10,long_input_tokens:0,long_cached_tokens:0,long_output_tokens:0};
function fixture(used=20){return {version:1,timezone:'America/Chicago',history_start:'2026-10-01T00:00:00Z',daily:[{date:'2026-11-12',models:[model]}],periods:{today:{start:'2026-11-12T06:00:00Z',end:'2026-11-12T12:00:00Z',coverage_complete:true,models:[model]},last7:{start:'2026-11-05T06:00:00Z',end:'2026-11-12T06:00:00Z',coverage_complete:true,models:[model]}},quota:{observed_at:'2026-11-12T12:00:00Z',plan_type:'pro',credit_balance:1000,unlimited_credits:false,windows:[{key:'primary',used_percent:used,window_minutes:10080,started_at:'2026-11-10T12:00:00Z',resets_at:'2026-11-17T12:00:00Z',started_at_basis:'reset time minus window duration'}]}};}
test('cached tokens counted once; API equivalent and credits use separate rates',()=>{
 const a=insightsCleanAnalytics(fixture());const r=buildInsights(a,{},clock);
 assert.equal(r.periods.today.total_tokens,1100000);
 assert.ok(Math.abs(r.periods.today.api_equivalent_usd-1.48)<1e-9);
 assert.equal(r.periods.today.credit_equivalent,37);
 assert.equal(r.quota.token_balance,null);
 assert.equal(r.quota.windows[0].remaining_percent,80);
 assert.equal(r.quota.windows[0].forecast,'reset_first');
 assert.equal(r.comparison.current,null);
});
test('forecast predicts exhaustion only before reset and suppresses stale readings',()=>{
 const a=insightsCleanAnalytics(fixture(80));const r=buildInsights(a,{},clock);
 assert.equal(r.quota.windows[0].forecast,'runs_out_before_reset');
 assert.equal(r.quota.windows[0].exhausts_at,'2026-11-13T00:00:00.000Z');
 const stale=buildInsights(a,{},clock+7200000);assert.equal(stale.quota.windows[0].forecast,'stale');assert.equal(stale.quota.windows[0].exhausts_at,null);
 assert.equal(stale.comparison.current,null);
});
test('long context surcharge, unknown model coverage and incomplete projections',()=>{
 const a=fixture();a.periods.today.models=[{...model,long_input_tokens:1000000,long_cached_tokens:800000,long_output_tokens:100000}];
 const r=buildInsights(insightsCleanAnalytics(a),{},clock);assert.ok(Math.abs(r.periods.today.api_equivalent_usd-2.46)<1e-9);
 a.periods.today.models=[{...model,model:'unknown-model'}];a.periods.last7.coverage_complete=false;
 const partial=buildInsights(insightsCleanAnalytics(a),{},clock);assert.equal(partial.periods.today.api_equivalent_usd,null);assert.equal(partial.comparison.monthly_api_equivalent_usd,null);
});
test('comparison never assumes alternative capacity; scenario changes with supplied multiple',()=>{
 const a=insightsCleanAnalytics(fixture(80));a.quota.plan_type='plus';
 const p={current_plan:'plus',alternative_plan:'pro100',credit_pack_usd:100,credit_pack_amount:100,alternative_allowance_multiple:null};
 const initial=buildInsights(a,p,clock);assert.equal(initial.comparison.alternative.monthly_total_usd,null);
 const r=buildInsights(a,{...p,alternative_allowance_multiple:3},clock);
 assert.equal(r.comparison.alternative.monthly_top_up_usd,0);
 assert.ok(r.comparison.current.monthly_total_usd>100);
 assert.match(r.comparison.recommendation,/Pro \$100/);
 assert.throws(()=>insightsCleanPreferences({alternative_allowance_multiple:0}));
});
test('malformed data rejected, unknown keys removed, zero pace has no invented forecast',()=>{
 const a=fixture(0);a.secret='PRIVATE';a.quota.account_id='PRIVATE';
 const clean=insightsCleanAnalytics(a);assert.ok(!JSON.stringify(clean).includes('PRIVATE'));
 const r=buildInsights(clean,{},clock);assert.equal(r.quota.windows[0].forecast,'insufficient_history');
 a.daily[0].models=[{...model,cached_tokens:1000001}];assert.throws(()=>insightsCleanAnalytics(a));
});
test('fresh Plus is automatic without persisting an inferred billed price',()=>{
 const a=fixture();a.quota.plan_type='plus';
 const r=buildInsights(insightsCleanAnalytics(a),{},clock);
 assert.equal(r.settings.current_plan,null);
 assert.equal(r.billing_detection.automatic_plan,'plus');
 assert.equal(r.billing_detection.plan_source,'codex_reported_family');
 assert.equal(r.comparison.current.monthly_subscription_usd,20);
 assert.equal(r.billing_detection.subscription_price_source,'published_usd_list_price');
 assert.equal(r.billing_detection.credit_price_source,'unavailable');
 assert.equal(r.comparison.usd_per_credit,null);
 a.quota.plan_type='pro';
 const changed=buildInsights(insightsCleanAnalytics(a),{},clock);
 assert.equal(changed.comparison.current,null);
 assert.equal(changed.billing_detection.automatic_plan,null);
 assert.match(changed.billing_detection.plan_message,/does not report/);
});
test('saved billing inputs override automatic defaults and retain their provenance',()=>{
 const r=buildInsights(insightsCleanAnalytics(fixture()),{current_plan:'pro200',credit_pack_usd:20,credit_pack_amount:500},clock);
 assert.equal(r.billing_detection.effective_plan,'pro200');
 assert.equal(r.billing_detection.plan_source,'saved_selection');
 assert.equal(r.billing_detection.credit_price_source,'saved_user_offer');
 assert.equal(r.comparison.usd_per_credit,.04);
 assert.equal(r.comparison.current.monthly_subscription_usd,200);
});
test('stale, future and unsupported readings never auto-select a plan',()=>{
 for(const [family,at] of [['plus',clock+7200000],['plus',clock-120000],['business',clock],['unknown',clock]]){
  const a=fixture();a.quota.plan_type=family;
  const r=buildInsights(insightsCleanAnalytics(a),{},at);
  assert.equal(r.billing_detection.automatic_plan,null);
  assert.equal(r.comparison.current,null);
 }
});
test('report leads with local runout time and never treats allowance as all access',()=>{
 const r=buildInsights(insightsCleanAnalytics(fixture(80)),{},clock).report;
 assert.equal(r.runway.hours_remaining,12);
 assert.match(r.runway.text,/12 hours/);
 assert.match(r.runway.text,/Nov 12, 6:00 PM CST/);
 assert.match(r.runway.text,/before the reset/);
 assert.equal(r.cheaper_plan.status,'needs_details');
 assert.match(r.cheaper_plan.text,/less allowance would also need top-ups/);
 assert.match(r.assumption,/not when paid credits or all access will end/);
 const stale=buildInsights(insightsCleanAnalytics(fixture(80)),{},clock+7200000).report;
 assert.equal(stale.runway.hours_remaining,null);assert.match(stale.runway.text,/stale/);
 const reset=buildInsights(insightsCleanAnalytics(fixture(10)),{},clock).report;
 assert.equal(reset.runway.hours_remaining,null);assert.match(reset.runway.text,/not projected to run out first/);
});
test('cheaper-plan verdict includes top-ups and may favor either tier',()=>{
 const a=insightsCleanAnalytics(fixture(80));
 const p={current_plan:'pro200',alternative_plan:'pro100',alternative_allowance_multiple:.5,credit_pack_usd:10,credit_pack_amount:1};
 const expensive=buildInsights(a,p,clock).report.cheaper_plan;
 assert.equal(expensive.status,'keep_current');assert.ok(expensive.monthly_savings_usd<0);
 const cheaper=buildInsights(a,{...p,credit_pack_usd:.04},clock).report.cheaper_plan;
 assert.equal(cheaper.status,'cheaper_plan_saves');assert.ok(cheaper.monthly_savings_usd>0);
 assert.match(cheaper.text,/included allowance alone would not cover/);
 const noOffer=buildInsights(a,{...p,credit_pack_usd:null},clock).report.cheaper_plan;
 assert.equal(noOffer.status,'needs_details');assert.equal(noOffer.monthly_savings_usd,null);
 const low=buildInsights(insightsCleanAnalytics(fixture(10)),{...p,credit_pack_usd:null},clock).report.cheaper_plan;
 assert.equal(low.status,'cheaper_plan_saves');assert.equal(low.monthly_savings_usd,100);
});
test('report chooses the first exhausting window and suppresses unsupported downgrade claims',()=>{
 const a=fixture(80);a.quota.windows.push({...a.quota.windows[0],key:'secondary',used_percent:90,window_minutes:300,started_at:'2026-11-12T11:00:00Z',resets_at:'2026-11-12T16:00:00Z'});
 const r=buildInsights(insightsCleanAnalytics(a),{current_plan:'pro200',alternative_plan:'pro100'},clock).report;
 assert.equal(r.runway.window,'secondary');
 assert.ok(r.runway.hours_remaining<1);
 assert.equal(r.cheaper_plan.status,'needs_details');
 const unsupported=buildInsights(insightsCleanAnalytics(fixture()),{current_plan:'pro200',alternative_plan:'pro500'},clock).report.cheaper_plan;
 assert.equal(unsupported.status,'needs_details');assert.equal(unsupported.monthly_savings_usd,null);
});
