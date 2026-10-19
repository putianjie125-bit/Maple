import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {isolatedServer} from './server-fixture.mjs';

const fake=fileURLToPath(new URL('./fake-consensus-cli.mjs',import.meta.url));
async function setup(t) {
  const server=await isolatedServer(); t.after(()=>server.close());
  await configureConsensus(server);return server;
}
async function configureConsensus(server) {
  const result=await server.api('POST','/api/config',{room:'default',config:{accounting:'automatic',hopBudget:0,
    agents:{codex:{command:fake},claude:{command:fake}}}});
  assert.equal(result.status,200,JSON.stringify(result));
}
async function settled(server) {
  for(let i=0;i<150;i++) {
    const result=await server.api('GET','/api/consensus?room=default');
    if(!result.data.active)return result.data.task;
    await new Promise(r=>setTimeout(r,30));
  }throw new Error('Consensus never settled: '+server.log());
}
test('consensus API is authenticated, versioned, validates bounds and remains opt-in',async t=>{
  const s=await setup(t);
  assert.equal((await fetch(s.url+'/api/consensus')).status,403);
  for(const maxRounds of [0,21,1.2,'3',null])assert.equal((await s.api('POST','/api/consensus/start',{question:'任务',maxRounds})).status,400);
  const status=await s.api('GET','/api/consensus');assert.equal(status.data.task.state,'IDLE');
  const html=await fetch(s.url).then(r=>r.text());assert.match(html,/value="chat">普通聊天/);assert.match(html,/consensusPanel" hidden/);
  const version=/consensus.js\?v=([^"\s]+)/.exec(html)[1];
  assert.equal((await fetch(s.url+'/ui/consensus.js?v='+version)).status,200);
  assert.equal((await fetch(s.url+'/ui/consensus.css?v='+version)).status,200);
  assert.equal((await fetch(s.url+'/ui/consensus.js?v=old')).status,409);
});
test('real CLI adapters reach bilateral consensus without automatic hops or chat session replacement',async t=>{
  const s=await setup(t);const before=await s.room('default');
  const response=await s.api('POST','/api/consensus/start',{question:'测试独立观点',maxRounds:3});assert.equal(response.status,202,JSON.stringify(response));
  const task=await settled(s);assert.equal(task.state,'CONSENSUS_REACHED',JSON.stringify(task));assert.equal(task.usedRounds,1);
  assert.equal(task.calls.length,4);assert.equal(task.finalResult.content,'模拟共同方案');
  for(const reply of task.discussions[0].replies) {
    const info=JSON.parse(reply.opinion);assert(info.independent);assert(!info.args.includes('--resume'));
    assert(!info.args.includes('bypassPermissions'));assert(!info.args.includes('danger-full-access'));
    if(reply.model==='codex')assert.equal(info.args[info.args.indexOf('--sandbox')+1],'read-only');
    else assert.equal(info.args[info.args.indexOf('--permission-mode')+1],'plan');
  }
  const after=await s.room('default');
  for(const seat of ['codex','claude'])assert.equal(after.room.agents[seat].sessionRef,before.room.agents[seat].sessionRef);
  assert.equal(after.entries.filter(e=>e.meta?.consensus&&e.kind==='agent').length,4);
  assert.equal(after.entries.filter(e=>e.meta?.relayCap).length,0);assert.equal(after.room.working,false);
  assert(fs.existsSync(path.join(s.root,'default','consensus','tasks',task.id+'.json')));
  const persisted=JSON.parse(fs.readFileSync(path.join(s.root,'default','consensus','tasks',task.id+'.json')));
  assert.deepEqual(persisted.finalResult,task.finalResult);assert.equal(persisted.calls.length,4);
  assert.equal((await s.api('GET','/api/consensus?id=missing')).status,404);
  const recorder=await s.api('GET','/api/recorder/status?room=default');
  assert.equal(recorder.status,200);assert.equal(recorder.data.model,'deepseek-flash');assert.equal(recorder.data.hasKey,false);
  assert(recorder.data.totalMessages>=5);assert.equal(recorder.data.busy,false);
});
test('ordinary chat before and after consensus keeps history, cursors and native sessions',async t=>{
  const s=await setup(t);await s.configure('default');
  await s.api('POST','/api/message',{room:'default',target:'codex',text:'SAY:CHAT_BEFORE'});
  let before;for(let i=0;i<80;i++){before=await s.room('default');if(!before.room.working&&!before.room.busy.length)break;await new Promise(r=>setTimeout(r,30));}
  assert(before.entries.some(e=>e.text==='CHAT_BEFORE'));assert(before.room.agents.codex.sessionRef);
  await configureConsensus(s);
  const stateFile=path.join(s.root,'default','state.json'),nativeBefore=JSON.parse(fs.readFileSync(stateFile)).agents;
  await s.api('POST','/api/consensus/start',{question:'协商',maxRounds:1});assert.equal((await settled(s)).state,'CONSENSUS_REACHED');
  const nativeAfter=JSON.parse(fs.readFileSync(stateFile)).agents;
  assert.equal(nativeAfter.codex.cursor,nativeBefore.codex.cursor);assert.equal(nativeAfter.codex.sessionRef,nativeBefore.codex.sessionRef);
  const agreed=(await s.api('GET','/api/consensus')).data.task;
  await s.configure('default');await s.api('POST','/api/message',{room:'default',target:'codex',text:'SAY:CHAT_AFTER'});
  let after;for(let i=0;i<80;i++){after=await s.room('default');if(!after.room.working&&!after.room.busy.length)break;await new Promise(r=>setTimeout(r,30));}
  assert(after.entries.some(e=>e.text==='CHAT_AFTER'));assert(after.entries.some(e=>e.text==='CHAT_BEFORE'));
  assert.equal((await s.api('GET','/api/consensus')).data.task.id,agreed.id);
});
test('one rejected confirmation reaches round cap without final result or hidden extra discussion',async t=>{
  const s=await setup(t);await s.api('POST','/api/consensus/start',{question:'REJECT',maxRounds:2});const task=await settled(s);
  assert.equal(task.state,'UNRESOLVED');assert.equal(task.usedRounds,2);assert.equal(task.calls.length,8);assert.equal(task.finalResult,null);
  assert.equal(task.candidates[0].confirmations.codex.decision,'AGREE');assert.equal(task.candidates[0].confirmations.claude.decision,'DISAGREE');
});
test('CLI exit failure becomes FAILED and does not silently retry or vote',async t=>{
  const s=await setup(t);await s.api('POST','/api/consensus/start',{question:'CLI_FAIL',maxRounds:3});const task=await settled(s);
  assert.equal(task.state,'FAILED');assert.equal(task.calls.length,2);assert.equal(task.finalResult,null);
});
test('stop kills actual mock CLI processes; concurrent chat and setting changes cannot enter round barriers',async t=>{
  const s=await setup(t);await s.api('POST','/api/consensus/start',{question:'SLOW',maxRounds:3});
  for(const [route,body] of [['/api/message',{text:'SAY:UNWANTED'}],['/api/consensus/start',{question:'覆盖'}],
    ['/api/config',{config:{mode:'work'}}],['/api/new',{}],['/api/model',{agent:'codex',model:null}],
    ['/api/seat/sleep',{agent:'claude',asleep:true}]]) {
    assert.equal((await s.api('POST',route,{room:'default',...body})).status,409,route);
  }
  assert.equal((await s.api('POST','/api/consensus/stop',{room:'default',id:'stale'})).status,409);
  assert.equal((await s.api('POST','/api/stop',{room:'default',scope:'active',runs:[{agent:'codex',runId:'old'}]})).data.stale,true);
  assert.equal((await s.api('GET','/api/consensus')).data.active,true);
  assert.equal((await s.api('POST','/api/stop',{room:'default',scope:'all'})).status,200);
  const task=await settled(s);assert.equal(task.state,'STOPPED');assert.equal(task.finalResult,null);
  for(let i=0;i<60;i++){const room=await s.room('default');if(!room.room.busy.length)break;await new Promise(r=>setTimeout(r,30));}
  assert.equal((await s.room('default')).room.busy.length,0);assert.equal(task.usedRounds,1);
});
test('renaming a room keeps consensus history and subsequent tasks in the renamed directory',async t=>{
  const s=await setup(t);assert.equal((await s.api('POST','/api/rooms',{name:'before-rename'})).status,200);
  await s.api('POST','/api/config',{room:'before-rename',config:{agents:{codex:{command:fake},claude:{command:fake}}}});
  await s.api('POST','/api/consensus/start',{room:'before-rename',question:'改名前',maxRounds:1});
  let first;for(let i=0;i<80;i++){const data=(await s.api('GET','/api/consensus?room=before-rename')).data;if(!data.active){first=data.task;break;}await new Promise(r=>setTimeout(r,30));}
  assert.equal(first.state,'CONSENSUS_REACHED');
  assert.equal((await s.api('POST','/api/room/rename',{room:'before-rename',to:'after-rename'})).status,200);
  assert.equal((await s.api('GET','/api/consensus?room=after-rename')).data.task.id,first.id);
  assert.equal((await s.api('POST','/api/consensus/start',{room:'after-rename',question:'改名后',maxRounds:1})).status,202);
  let after;for(let i=0;i<80;i++){const data=(await s.api('GET','/api/consensus?room=after-rename')).data;if(!data.active){after=data;break;}await new Promise(r=>setTimeout(r,30));}
  assert.equal(after.task.state,'CONSENSUS_REACHED');assert.equal(after.tasks.length,2);
  assert(!fs.existsSync(path.join(s.root,'before-rename')));
});
test('sleeping participants are rejected rather than granting unequal opportunities',async t=>{
  const s=await setup(t);await s.api('POST','/api/seat/sleep',{room:'default',agent:'claude',asleep:true});
  assert.equal((await s.api('POST','/api/consensus/start',{question:'任务'})).status,409);
  assert.equal((await s.api('GET','/api/consensus')).data.task.state,'IDLE');
});
test('actual CLI timeout terminates both processes and records FAILED',async t=>{
  const s=await setup(t);
  assert.equal((await s.api('POST','/api/config',{room:'default',config:{timeoutMs:10000}})).status,200);
  await s.api('POST','/api/consensus/start',{question:'SLOW timeout',maxRounds:1});
  let task;for(let i=0;i<160;i++) {
    const data=(await s.api('GET','/api/consensus')).data;task=data.task;
    if(!data.active)break;await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(task.state,'FAILED');assert.equal(task.finalResult,null);assert.equal(task.calls.length,2);
  assert(task.calls.every(c=>c.status==='FAILED'));
});
