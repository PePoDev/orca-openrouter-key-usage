import assert from 'node:assert/strict';
import test from 'node:test';
import { keyUsage, generationUsage } from '../api.mjs';
import { start, recordDay } from '../worker.mjs';

const token = 'sk-or-' + 'dummy-credential-for-tests';
const other = 'sk-or-' + 'second-dummy-for-tests';
const response = data => Response.json({ data });
const budget = {scope:'member', reset_interval:'daily', limit_usd:8, remaining_usd:2, spend_usd:6};
const fixture = { usage:12.5, usage_daily:1.25, usage_weekly:2, usage_monthly:8, byok_usage_daily:0,
  limit:100, limit_remaining:87.5, limit_reset:'monthly', budgets:[budget], effective_budget:budget,
  free_model_daily_requests:{used:10,remaining:40,limit:50}, allowed_data_regions:['eu'], expires_at:null };

test('ordinary key exposes spend, separate BYOK, budgets and missing fields', async () => {
  const result = await keyUsage(token, async (url, init) => {
    assert.equal(String(url), 'https://openrouter.ai/api/v1/key');
    assert.equal(init.method,'GET'); assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization, 'Bearer ' + token);
    return response({...fixture, label:token, creator_user_id:'private-user'});
  });
  assert.deepEqual(result.periods[0],{spend:1.25,byok:0});
  assert.equal(result.periods[1].byok,null);
  assert.equal(result.effective.left,2);
  assert.deepEqual(result.budgets.map(b => b.cap),[8,100]);
  assert.equal(result.freeRequests.left,40);
  assert.equal(result.noExpiry,true);
  for (const hidden of [token,'private-user']) assert.ok(!JSON.stringify(result).includes(hidden));
});

test('requests use only caller-supplied generation IDs and return selected metadata', async () => {
  let calls = 0;
  const fetcher = async (url,init) => {
    calls++;
    assert.equal(String(url),'https://openrouter.ai/api/v1/generation?id=gen-test');
    assert.equal(init.redirect,'error');
    return response({id:'gen-test',model:'model/a',native_tokens_prompt:0,tokens_prompt:4,tokens_completion:12,total_cost:0.002,external_user:'private-user'});
  };
  await assert.rejects(generationUsage(token,'https://example.org',fetcher),/gen-/);
  const r = await generationUsage(token,'gen-test',fetcher);
  assert.equal(calls,1); assert.equal(r.input,0); assert.equal(r.output,12); assert.equal(r.cost,0.002);
  assert.ok(!JSON.stringify(r).includes('private-user'));
});

test('rolls samples by UTC day, excludes aged rows and preserves missed days', () => {
  let days = [];
  for (const [stamp,spend] of [['2026-03-01T04:00Z',4],['2026-06-10T23:00Z',9],['2026-06-10T23:50Z',10],['2026-06-12T00:10Z',0]]) {
    days = recordDay(days,[{spend,byok:null}],Date.parse(stamp));
  }
  assert.deepEqual(days.map(d=>[d.day,d.spend]),[['2026-06-10',10],['2026-06-12',0]]);
});

test('worker verifies before saving, isolates keys, survives failures and disconnects', async t => {
  const secret = new Map(), cache = new Map(), handlers = new Map();
  const store = map => ({get:async k=>map.get(k)??null,set:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k)});
  const ctx = {panel:{surface:'panel',contributionId:'dashboard'}};
  const call = (name,input) => handlers.get(name)(input,ctx);
  let fail = false;
  const fetcher = async url => {
    if (fail) return new Response(token,{status:401});
    if (String(url).includes('/generation?')) return response({id:'gen-test',model:'a',total_cost:0});
    return response(fixture);
  };
  const host = {secrets:store(secret),storage:store(cache),host:{call:async()=>{}},
    commands:{register(){}},panels:{post(){},handle:(k,v)=>handlers.set(k,v)}};
  const stop = await start(host,{fetcher}); t.after(stop);
  assert.equal((await call('state')).data.configured,false);
  assert.throws(()=>handlers.get('state')(null,{panel:{surface:'editor'}}),/Unknown panel/);
  await call('connect',{token}); await Promise.all([call('track',{id:'gen-test'}),call('track',{id:'gen-test'})]);
  assert.equal((await call('state')).data.requests.length,1);
  fail = true;
  const failure = await call('connect',{token:other});
  assert.match(failure.error,/rejected/); assert.ok(!failure.error.includes(token));
  const stale = (await call('refresh')).data;
  assert.equal(stale.requests.length,1); assert.ok(stale.warning); assert.ok(stale.updated);
  fail = false; const replacement = (await call('connect',{token:other})).data;
  assert.equal(replacement.requests.length,0); assert.equal(replacement.days.length,1);
  assert.ok(!JSON.stringify([...cache.values()]).includes('sk-or-'));
  assert.ok(!JSON.stringify(replacement).includes('sk-or-'));
  assert.equal((await call('disconnect')).data.configured,false);
  assert.equal(secret.size,0); assert.equal(cache.size,0);
});
