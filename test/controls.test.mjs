import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {consumeCodexReset,resetCredits,readCodexLimits} from '../lib/quota.mjs';

test('reset count is authoritative and missing data is not treated as zero',()=>{
 assert.equal(resetCredits({}).availableCount,null);
 const value=resetCredits({rateLimitResetCredits:{availableCount:3,credits:[{id:'two',status:'available',expiresAt:200},{id:'used',status:'consumed'},{id:'one',status:'available',expiresAt:100}]}});
 assert.equal(value.availableCount,3);assert.deepEqual(value.credits.map(c=>c.id),['one','two']);
});
test('reset redemption preserves the request key, rereads limits and never starts a model turn',async()=>{
 const seen=[],used=new Set();let charged=0;
 const spawnImpl=()=>{
  const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{};
  child.stdin=new Writable({write(chunk,_enc,cb){const request=JSON.parse(String(chunk));seen.push(request);
   queueMicrotask(()=>{
    if(request.method==='initialized')return;
    let result={};
    if(request.method==='account/rateLimitResetCredit/consume'){
     if(used.has(request.params.idempotencyKey))result={outcome:'alreadyRedeemed'};
     else{used.add(request.params.idempotencyKey);charged++;result={outcome:'reset'};}
    }else if(request.method==='account/rateLimits/read')result={rateLimits:{primary:{usedPercent:0}},rateLimitResetCredits:{availableCount:3-charged,credits:[]}};
    else assert.equal(request.method,'initialize');
    child.stdout.write(JSON.stringify({id:request.id,result})+'\n');
   });cb();}});return child;
 };
 const request={idempotencyKey:randomUUID()};const spec={cmd:'fixture',pre:[]};
 const first=await consumeCodexReset(spec,request,{spawnImpl});const retry=await consumeCodexReset(spec,request,{spawnImpl});
 assert.equal(first.outcome,'reset');assert.equal(first.buckets[0].windows[0].remainingPercent,100);assert.equal(retry.outcome,'alreadyRedeemed');assert.equal(charged,1);
 const methods=seen.map(x=>x.method);assert.ok(!methods.includes('turn/start'));assert.equal(methods.filter(m=>m==='account/rateLimits/read').length,2);
 await readCodexLimits(spec,{spawnImpl});assert.equal(charged,1);
 await assert.rejects(consumeCodexReset(spec,{idempotencyKey:'invalid'},{spawnImpl}),/编号/);
});
