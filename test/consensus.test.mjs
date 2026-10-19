import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createConsensus, contentHash, newCandidate, jointlyConfirmed, requireRounds} from '../lib/consensus.mjs';

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'maple-consensus-'));
  t.after(() => fs.rmSync(directory, {recursive:true, force:true}));
  const calls = [], publications = [];
  const invoke = async call => {
    const data = JSON.parse(call.prompt.split('\n').at(-1)); calls.push({...call, data});
    const result = await options.reply?.(call, data);
    if (result !== undefined) return typeof result === 'string' ? {text:result} : result;
    return {text:JSON.stringify(call.phase === 'confirmation'
      ? {model:call.model, version:data.candidate.version, hash:data.candidate.hash, decision:'AGREE', reason:'接受完整方案'}
      : {opinion:'独立提出观点', proposal:'共同方案', disagreements:[]})};
  };
  const service = createConsensus({directory, invoke, publish:x => publications.push(x), timeoutMs:options.timeoutMs || 1000});
  return {service, directory, calls, publications};
}
const refusal = (call, data, decision) => ({text:JSON.stringify({model:call.model, version:data.candidate.version,
  hash:data.candidate.hash, decision, reason:decision === 'AGREE' ? '接受方案' : '需要补充证据和修改方案'})});

test('both independently agree in round one, with identical task and confirmation prompts', async t => {
  const {service, calls, publications} = fixture(t);
  service.start('相同原始任务', 3); await service.wait();
  const task = service.snapshot(); assert.equal(task.state, 'CONSENSUS_REACHED'); assert.equal(task.usedRounds, 1);
  assert.equal(task.calls.length, 4); assert.equal(task.finalResult.hash, contentHash('共同方案'));
  assert.equal(calls[0].prompt, calls[1].prompt); assert.equal(calls[2].prompt, calls[3].prompt);
  assert.deepEqual(calls[0].data.previousRounds, []); assert.deepEqual(calls[0].data.previousCandidates, []);
  assert(!('confirmations' in calls[2].data.candidate)); assert.equal(publications.length, 2);
  assert(calls.every(c => c.taskId === task.id && c.round === 1 && ['codex','claude'].includes(c.model)));
  assert(task.calls.every(c => c.startedAt && c.finishedAt));
});
test('round two revises proposal, delivers both rejection reasons and invalidates old confirmations', async t => {
  const {service, calls} = fixture(t, {reply(call,data) {
    if (call.phase === 'confirmation') return refusal(call,data, call.round === 1 && call.model === 'claude' ? 'DISAGREE' : 'AGREE');
    return {text:JSON.stringify({opinion:'独立观点', proposal:call.round === 1 ? '初案' : '修订方案', disagreements:[]})};
  }});
  service.start('第二轮',3); await service.wait();
  const task = service.snapshot(); assert.equal(task.state,'CONSENSUS_REACHED'); assert.equal(task.usedRounds,2);
  assert.equal(task.candidates.length,2); assert.equal(task.candidates[0].confirmations.claude.decision,'DISAGREE');
  assert.equal(task.candidates[1].confirmations.codex.version,2); assert.equal(task.finalResult.content,'修订方案');
  const second = calls.filter(c => c.phase === 'discussion'); assert.equal(second.length,2);
  assert.equal(second[0].prompt,second[1].prompt); assert.match(second[0].prompt,/需要补充证据/);
});
for (const [codex, claude] of [['AGREE','DISAGREE'],['DISAGREE','AGREE'],['DISAGREE','DISAGREE']]) {
  test(`round cap: codex=${codex}, claude=${claude} never reaches consensus`, async t => {
    const {service} = fixture(t,{reply:(call,data) => call.phase === 'confirmation' ? refusal(call,data,call.model === 'codex' ? codex : claude) : undefined});
    service.start('分歧',3); await service.wait(); const task=service.snapshot();
    assert.equal(task.state,'UNRESOLVED'); assert.equal(task.usedRounds,3); assert.equal(task.finalResult,null);
    assert.equal(task.discussions.length,3); assert(task.unresolved.length);
    assert.equal(task.calls.filter(c=>c.phase!=='confirmation').length,6); assert.equal(task.calls.length,12);
  });
}
for (const invalid of ['version','hash','model','prose','empty-reason']) {
  test(`invalid ${invalid} confirmation fails closed without inventing a vote`, async t => {
    const {service}=fixture(t,{reply(call,data) {
      if(call.phase!=='confirmation'||call.model!=='claude')return;
      const value={model:'claude',version:data.candidate.version,hash:data.candidate.hash,decision:'AGREE',reason:'接受'};
      if(invalid==='prose')return '我们已经达成共识 AGREE';
      if(invalid==='empty-reason')value.reason='';else value[invalid]=invalid==='version'?999:'WRONG';
      return {text:JSON.stringify(value)};
    }});
    service.start('严格确认',1); await service.wait(); const task=service.snapshot();
    assert.equal(task.state,'UNRESOLVED'); assert.equal(task.candidates[0].confirmations.claude.valid,false);
    assert.equal(task.candidates[0].confirmations.claude.decision,null); assert.equal(task.finalResult,null);
  });
}
test('new candidates start with no old votes even for the same text', () => {
  const task={candidates:[],usedRounds:1}; const first=newCandidate(task,'A','codex');
  for(const model of ['codex','claude'])first.confirmations[model]={valid:true,model,version:1,hash:first.hash,decision:'AGREE'};
  assert(jointlyConfirmed(first));
  const second=newCandidate(task,'A','claude'); assert.deepEqual(second.confirmations,{}); assert(!jointlyConfirmed(second));
  assert.equal(second.version,2); first.content='edited'; assert(!jointlyConfirmed(first));
  assert.throws(()=>newCandidate(task,'C','deepseek'));
});
test('both proposals have equal bilateral voting rights; rejected first proposal does not discard peer proposal', async t => {
  const {service,calls}=fixture(t,{reply(call,data) {
    if(call.phase==='confirmation')return refusal(call,data,data.candidate.content==='claude方案'?'AGREE':'DISAGREE');
    return {text:JSON.stringify({opinion:'观点',proposal:call.model+'方案',disagreements:[]})};
  }});
  service.start('平等提案',1);await service.wait();const task=service.snapshot();
  assert.equal(task.state,'CONSENSUS_REACHED'); assert.equal(task.finalResult.content,'claude方案');
  assert.equal(calls.length,6);assert.equal(task.candidates.length,2);
  assert.deepEqual(task.candidates.map(c=>Object.keys(c.confirmations)),[['codex','claude'],['codex','claude']]);
});
test('both discussion and confirmation phases use barriers and hide fast peer output',async t=>{
  let release,ready;const blocked=new Promise(r=>release=r),entered=new Promise(r=>ready=r);
  const {service,publications}=fixture(t,{async reply(call) {if(call.phase==='initial'&&call.model==='claude'){ready();await blocked;}}});
  service.start('屏障');await entered;await new Promise(r=>setTimeout(r,10));
  assert.equal(publications.length,0);assert.equal(service.snapshot().discussions.length,0);
  release();await service.wait();assert.equal(service.snapshot().state,'CONSENSUS_REACHED');
});
test('no proposals and natural-language claims never imply consensus',async t=>{
  const {service}=fixture(t,{reply:()=>({text:JSON.stringify({opinion:'我们已经达成共识',proposal:null,disagreements:[]})})});
  service.start('自然语言',2);await service.wait();const task=service.snapshot();
  assert.equal(task.state,'UNRESOLVED');assert.equal(task.calls.length,4);assert(task.unresolved.length);
});
test('fast confirmation is withheld until both independent confirmation calls finish',async t=>{
  let release,entered;const blocked=new Promise(r=>release=r),ready=new Promise(r=>entered=r);
  const {service,publications,calls}=fixture(t,{async reply(call){if(call.phase==='confirmation'&&call.model==='claude'){entered();await blocked;}}});
  service.start('独立确认',1);await ready;await new Promise(r=>setTimeout(r,10));
  const pending=service.snapshot();assert.equal(pending.state,'PENDING_CONFIRMATION');
  assert.deepEqual(pending.candidates[0].confirmations,{});assert.equal(publications.length,1);
  assert.equal(calls[2].prompt,calls[3].prompt);assert(!calls[3].prompt.includes('confirmations'));
  release();await service.wait();assert.equal(service.snapshot().state,'CONSENSUS_REACHED');
});
test('distinct proposal consideration order alternates and discussion opportunities stay equal',async t=>{
  const {service}=fixture(t,{reply(call,data){
    return call.phase==='confirmation'?refusal(call,data,'DISAGREE'):{text:JSON.stringify({opinion:'观点',proposal:call.model+call.round,disagreements:[]})};
  }});
  service.start('交替顺序',2);await service.wait();const task=service.snapshot();
  assert.equal(task.state,'UNRESOLVED');assert.deepEqual(task.candidates.map(c=>c.proposer),['codex','claude','claude','codex']);
  assert.equal(task.calls.length,12);for(const model of ['codex','claude'])assert.equal(task.calls.filter(c=>c.model===model&&c.phase!=='confirmation').length,2);
});
for(const phase of ['initial','confirmation']) {
  test(`CLI failure in ${phase} is FAILED and never defaults to agreement`,async t=>{
    const {service}=fixture(t,{reply(call){if(call.phase===phase&&call.model==='claude')throw new Error('failure');}});
    service.start('失败',3);await service.wait();const task=service.snapshot();assert.equal(task.state,'FAILED');assert.equal(task.finalResult,null);
    assert.equal(task.calls.filter(c=>c.phase===phase).length,2);
  });
}
test('CLI timeout aborts both hung calls and cannot loop',async t=>{
  const signals=[];const {service}=fixture(t,{timeoutMs:20,reply(call){signals.push(call.signal);return new Promise(()=>{});}});
  service.start('超时');await service.wait();assert.equal(service.snapshot().state,'FAILED');assert(signals.every(s=>s.aborted));assert.equal(service.snapshot().calls.length,2);
});
for(const phase of ['initial','confirmation']) {
  test(`user stops ${phase}; late results cannot reach consensus`,async t=>{
    let entered;const ready=new Promise(r=>entered=r);let release;const blocked=new Promise(r=>release=r);
    const {service}=fixture(t,{async reply(call){if(call.phase===phase){entered();await blocked;}}});
    service.start('停止');await ready;service.stop();assert.equal(service.snapshot().state,'STOPPED');
    release();await service.wait();assert.equal(service.snapshot().state,'STOPPED');assert.equal(service.snapshot().finalResult,null);
  });
}
test('stop before launch starts no CLI; busy tasks reject another start',async t=>{
  const {service,calls}=fixture(t);service.start('停止');assert.throws(()=>service.start('覆盖'),/运行/);
  service.stop();await service.wait();assert.equal(calls.length,0);assert.equal(service.snapshot().state,'STOPPED');
});
test('restart recovers complete and interrupted task history without declaring interrupted agreement',async t=>{
  const {service,directory}=fixture(t);service.start('完成',1);await service.wait();
  const reached=service.snapshot();let restarted=createConsensus({directory,invoke:()=>assert.fail('restart invoked CLI')});
  assert.equal(restarted.snapshot().state,'CONSENSUS_REACHED');assert.equal(restarted.snapshot().finalResult.hash,reached.finalResult.hash);
  const file=path.join(directory,reached.id+'.json');reached.state='PENDING_CONFIRMATION';reached.finalResult=null;
  fs.writeFileSync(file,JSON.stringify(reached));
  restarted=createConsensus({directory,invoke:()=>assert.fail('restart invoked CLI')});
  assert.equal(restarted.snapshot().state,'FAILED');assert.equal(restarted.snapshot().finalResult,null);
  assert.equal(restarted.snapshot().candidates[0].content,'共同方案');assert.equal(restarted.list().length,1);
});
test('invalid persisted success is recovered as FAILED',async t=>{
  const {service,directory}=fixture(t);service.start('完整性',1);await service.wait();const task=service.snapshot();
  task.candidates[0].confirmations.claude.hash='wrong';fs.writeFileSync(path.join(directory,task.id+'.json'),JSON.stringify(task));
  assert.equal(createConsensus({directory,invoke:()=>{}}).snapshot().state,'FAILED');
});
test('round settings are bounded integers; histories and token evidence remain exact',async t=>{
  for(const value of [0,21,-1,1.5,'3',null,NaN,Infinity])assert.throws(()=>requireRounds(value));
  assert.equal(requireRounds(),3);assert.equal(requireRounds(20),20);
  const {service}=fixture(t);assert.equal(service.snapshot().state,'IDLE');
  assert.throws(()=>service.start(' ',3));service.start('默认');await service.wait();const first=service.snapshot();
  assert.equal(first.maxRounds,3);assert(!('usage' in first.calls[0]));
  service.start('下一任务',1);await service.wait();assert.equal(service.list().length,2);assert.equal(service.snapshot(first.id).question,'默认');
  assert.equal(service.snapshot('missing'),null);
});
test('corrupt optional records are preserved without blocking chat or inventing consensus',async t=>{
  const {service,directory}=fixture(t);service.start('记录',1);await service.wait();const task=service.snapshot();
  const file=path.join(directory,task.id+'.json');fs.writeFileSync(file,'{truncated');
  const restarted=createConsensus({directory,invoke:()=>assert.fail('unexpected CLI')});
  assert.equal(restarted.snapshot().state,'FAILED');assert.equal(fs.readFileSync(file,'utf8'),'{truncated');
  restarted.start('新任务',1);await restarted.wait();assert.equal(restarted.snapshot().state,'FAILED');
  assert.equal(fs.readFileSync(file,'utf8'),'{truncated');
});
test('disk failure during a running task terminates safely and releases the task lock',async t=>{
  let fail=false;
  const {service,directory}=fixture(t,{reply(){if(!fail){fail=true;fs.rmSync(directory,{recursive:true,force:true});fs.writeFileSync(directory,'disk unavailable');}}});
  service.start('磁盘失败',1);await service.wait();assert.equal(service.snapshot().state,'FAILED');assert.equal(service.active,false);
  assert.throws(()=>service.start('仍不能写入',1));assert.equal(service.active,false);
});
