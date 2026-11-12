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
