import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {normalizeCodex,quotaWindow,claudeObservation,readCodexLimits,createQuota} from '../lib/quota.mjs';
import {createRecorder} from '../lib/recorder.mjs';

const now=Date.now(),reset=Math.floor(now/1000)+10000;
test('remaining percentage handles multiple buckets, zero and unknown without invented reset',()=>{
 const result=normalizeCodex({rateLimits:{primary:{usedPercent:88}},rateLimitsByLimitId:{codex:{primary:{usedPercent:57,windowDurationMins:10080,resetsAt:reset}},other:{primary:{usedPercent:100},secondary:{usedPercent:null}}}},now);
 assert.equal(result[0].windows[0].remainingPercent,43);assert.equal(result[0].windows[0].label,'每周额度');
 assert.equal(result[1].windows[0].remainingPercent,0);assert.equal(result[1].windows[1].remainingPercent,null);
 assert.equal(quotaWindow({usedPercent:50,resetsAt:1},'test',now).remainingPercent,null);
 assert.equal(quotaWindow({usedPercent:'20'},'test',now).remainingPercent,null);
 assert.equal(quotaWindow({usedPercent:120},'test',now).remainingPercent,0);
});

test('Codex RPC only initializes and reads limits, redacting unexpected provider errors',async()=>{
 const requests=[];let killed=false;
 const spawnImpl=(_cmd,args)=>{
  assert.deepEqual(args,['app-server','--listen','stdio://']);
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{killed=true;};
  child.stdin=new Writable({write(chunk,_encoding,cb){const m=JSON.parse(String(chunk));requests.push(m);queueMicrotask(()=>{
   if(m.id===1)child.stdout.write(JSON.stringify({id:1,result:{}})+'\n');
   if(m.id===2)child.stdout.write(JSON.stringify({id:2,result:{rateLimits:{primary:{usedPercent:7,resetsAt:reset}}}})+'\n');
  });cb();}});return child;
 };
 const result=await readCodexLimits({cmd:'fixture',pre:[]},{spawnImpl});
 assert.equal(result.buckets[0].windows[0].remainingPercent,93);assert.ok(killed);
 assert.deepEqual(requests.map(x=>x.method),['initialize','initialized','account/rateLimits/read']);
 await assert.rejects(readCodexLimits({cmd:'fixture',pre:[]},{spawnImpl:()=>{throw Error('CREDENTIAL_SENTINEL');}}),e=>!e.message.includes('SENTINEL'));
});

test('Claude observations preserve unknown utilization, expire reset windows and reject unrecognized payloads',()=>{
 assert.equal(claudeObservation({status:'allowed',rateLimitType:'five_hour'},now).usedPercent,null);
 const value=claudeObservation({status:'allowed_warning',rateLimitType:'seven_day',utilization:.81,resetsAt:reset},now);
 assert.equal(quotaWindow(value,value.label,now).remainingPercent,19);
 assert.equal(claudeObservation({status:'random',utilization:0},now),null);
 assert.equal(claudeObservation({status:'allowed',rateLimitType:'__proto__'},now).type,'unknown');
});

test('quota requests coalesce, cache, invalidate on room provider command and drop old values on failure',async()=>{
 let time=now,calls=0,fail=false;
 const service=createQuota({now:()=>time,resolveCommand:cmd=>({cmd}),readCodex:async()=>{calls++;await new Promise(r=>setTimeout(r,10));if(fail)throw Error('raw secret');return {buckets:[{windows:[{remainingPercent:50}]}],updatedAt:'now'};},recorder:{balance:async()=>({state:'unconfigured'})}});
 const room={cfg:{agents:{codex:{provider:'codex',command:'one'},claude:{provider:'claude'}}},state:{}};
 await Promise.all([service.status(room),service.status(room)]);assert.equal(calls,1);
 await service.status(room);assert.equal(calls,1);
 time+=11000;await service.status(room,{force:true});assert.equal(calls,2);
 room.cfg.agents.codex.command='two';await service.status(room);assert.equal(calls,3);
 time+=61000;fail=true;const result=await service.status(room);assert.equal(result.codex.buckets.length,0);assert.ok(!JSON.stringify(result).includes('secret'));
});

const root=fs.mkdtempSync(path.join(process.cwd(),'.quota-test-'));
function recorder(fetchImpl,key='sk-fixture-key-not-real'){
 const dir=fs.mkdtempSync(path.join(root,'balance-'));
 const store={has:()=>!!key,get:async()=>key,set:async value=>{key=value;},remove:async()=>{key='';}};
 return createRecorder({root:dir,defaultPath:path.join(dir,'notes'),saveState:()=>{},secretStore:store,fetchImpl});
}
test('DeepSeek balance is GET only, cached, preserves currencies and never returns a key',async()=>{
 let calls=0;
 const service=recorder(async(url,options)=>{
  calls++;assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.redirect,'error');
  return {ok:true,json:async()=>({is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.3456',extra:'secret'},{currency:'USD',total_balance:'0.00'}]})};
 });
 const result=await service.balance();assert.equal(result.balances.length,2);assert.equal(result.balances[0].total,'12.3456');assert.ok(!JSON.stringify(result).includes('secret'));
 await service.balance();assert.equal(calls,1);
 await service.settings({apiKey:'sk-replacement-fixture'});await service.balance();assert.equal(calls,2);
 await service.settings({removeKey:true});assert.equal((await service.balance()).state,'unconfigured');assert.equal(calls,2);service.close();
});
test('DeepSeek errors and malformed balances never invent a zero balance or expose provider text',async()=>{
 const error=recorder(async()=>({ok:false,status:401,json:async()=>({error:'sk-fixture-key-not-real'})}));
 const result=await error.balance();assert.equal(result.state,'error');assert.equal(result.balances.length,0);assert.ok(!JSON.stringify(result).includes('fixture-key'));error.close();
 const malformed=recorder(async()=>({ok:true,json:async()=>({balance_infos:[{currency:'CNY',total_balance:'unknown'}]})}));
 assert.equal((await malformed.balance()).state,'error');malformed.close();
});
test('a balance query completing after key removal cannot repopulate the old balance',async()=>{
 let release;const service=recorder(async()=>{await new Promise(r=>{release=r;});return {ok:true,json:async()=>({balance_infos:[{currency:'CNY',total_balance:'99.00'}]})};});
 const pending=service.balance();while(!release)await new Promise(r=>setTimeout(r,1));await service.settings({removeKey:true});release();
 assert.equal((await pending).state,'changed');assert.equal((await service.balance()).state,'unconfigured');service.close();
});
