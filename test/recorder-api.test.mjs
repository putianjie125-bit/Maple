import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRecorder} from '../lib/recorder.mjs';

const here=path.dirname(fileURLToPath(import.meta.url)),app=path.dirname(here);
const root=fs.mkdtempSync(path.join(app,'.recorder-api-')),notes=path.join(root,'notes'),roomDir=path.join(root,'data','default');
fs.mkdirSync(roomDir,{recursive:true});
const stateFile=path.join(roomDir,'state.json');
const state={nextTurn:21,agents:{claude:{cursor:20,sessionRef:null,asleep:{since:'2026-10-16',reason:'test sleep'}},codex:{cursor:20,sessionRef:null,asleep:null}},cancelledDeliveries:{}};
const entries=[];
for(let n=1;n<=20;n++)entries.push({n,kind:n%2?'user':'agent',author:n%2?'user':'codex',target:n%2?'codex':null,ts:'2026-10-16T12:00:00',text:n===1?'我决定保留原文。 OMITTED_OLD_RAW':'recent-dialogue-'+n});
const room={name:'default',dir:roomDir,state,entries};
const memory={goal:'MEMORY_ANCHOR 项目记忆接续验证',constraints:[],decisions:[{text:'保留原文',sources:[1],user_source:1,user_quote:'我决定保留原文。'}],view_changes:[],open_questions:[],next_steps:[]};
const seed=createRecorder({root:path.join(root,'data'),defaultPath:notes,saveState:r=>fs.writeFileSync(stateFile,JSON.stringify(r.state)),secretStore:{has:()=>true,get:async()=> 'synthetic'},fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(memory)}}]})})});
await seed.summarize(room);seed.close();fs.writeFileSync(stateFile,JSON.stringify(state));
fs.writeFileSync(path.join(roomDir,'events.jsonl'),entries.map(e=>JSON.stringify(e)).join('\n')+'\n');
const originalEvents=fs.readFileSync(path.join(roomDir,'events.jsonl'),'utf8');
fs.writeFileSync(path.join(roomDir,'transcript.md'),'ORIGINAL_TRANSCRIPT_SENTINEL\n');
const fake=path.join(here,'fake-cli.mjs');
fs.writeFileSync(path.join(roomDir,'room.json'),JSON.stringify({defaultAgent:'codex',mode:'talk',accounting:'automatic',hopBudget:0,timeoutMs:30000,agents:{claude:{provider:'claude',command:fake,model:null,extraArgs:[],lurk:false,permissionMode:'auto'},codex:{provider:'codex',command:fake,model:null,extraArgs:[],lurk:false,sandbox:'read-only'}}}));
const processChild=spawn(process.execPath,[path.join(app,'parley.mjs'),'--root',path.join(root,'data'),'--port','0','--no-open'],{cwd:app,env:{...process.env,PARLEY_RECORDER_DIR:notes},windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='',errors='',base='',token='';processChild.stdout.setEncoding('utf8');processChild.stderr.setEncoding('utf8');processChild.stdout.on('data',s=>output+=s);processChild.stderr.on('data',s=>errors+=s);
for(let i=0;i<100&&!base;i++){base=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0]||'';if(processChild.exitCode!==null)throw new Error(errors);if(!base)await new Promise(r=>setTimeout(r,50));}
assert.ok(base,'server started: '+errors);
const html=await(await fetch(base)).text();token=/name="parley-token" content="([^"]+)"/.exec(html)[1];
const headers={'X-Parley-Token':token,'X-Parley-Runtime-Protocol':'12'};
async function api(endpoint,body){const res=await fetch(base+endpoint,body===undefined?{headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:res.status,data:await res.json()};}
test.after(()=>{processChild.kill();});

test('recorder API requires the existing token and rejects cross-origin writes',async()=>{
 assert.equal((await fetch(base+'/api/recorder/status')).status,403);
 assert.equal((await fetch(base+'/api/recorder/settings',{method:'POST',headers:{...headers,'Content-Type':'application/json',Origin:'https://unrelated.example'},body:'{}'})).status,403);
});
test('status reads persisted memory without asking for a key or exposing it',async()=>{
 const result=await api('/api/recorder/status?room=default');assert.equal(result.status,200);assert.equal(result.data.model,'deepseek-flash');assert.equal(result.data.hasKey,false);assert.equal(result.data.canContinue,true);assert.match(result.data.markdown,/MEMORY_ANCHOR/);assert.ok(!JSON.stringify(result).includes('synthetic'));
});
test('from-memory continuation keeps source logs, sleep and sandbox but resets native sessions',async()=>{
 const result=await api('/api/recorder/continue',{room:'default'});assert.equal(result.status,200);assert.equal(result.data.compacted.floorN,12);
 const current=JSON.parse(fs.readFileSync(stateFile));assert.equal(current.agents.claude.asleep.reason,'test sleep');assert.equal(current.agents.codex.sessionRef,null);
 const config=JSON.parse(fs.readFileSync(path.join(roomDir,'room.json')));assert.equal(config.agents.codex.sandbox,'read-only');assert.equal(config.mode,'talk');
 assert.ok(fs.readFileSync(path.join(roomDir,'events.jsonl'),'utf8').startsWith(originalEvents));assert.match(fs.readFileSync(path.join(roomDir,'transcript.md'),'utf8'),/ORIGINAL_TRANSCRIPT_SENTINEL/);
});
test('adopting requires the inspected version and delivers the user correction to both agents',async()=>{
 const stale=await api('/api/recorder/adopt',{room:'default',version:99,reviewNote:'changed'});assert.equal(stale.status,409);
 const accepted=await api('/api/recorder/adopt',{room:'default',version:1,reviewNote:'REVIEW_CORRECTION: 原文保留，摘要不是执行授权。'+'修订。'.repeat(400)});
 assert.equal(accepted.status,200);assert.match(accepted.data.compacted.reviewNote,/REVIEW_CORRECTION/);
 const current=JSON.parse(fs.readFileSync(stateFile));assert.equal(current.recorderContext.version,1);assert.match(current.recorderContext.reviewNote,/REVIEW_CORRECTION/);
 const folders=fs.readdirSync(notes).filter(name=>name.startsWith('default-'));assert.ok(fs.readFileSync(path.join(notes,folders[0],'已采用记忆.md'),'utf8').includes('REVIEW_CORRECTION'));
});
test('model switching uses the selected provider catalog and preserves adopted memory, raw history and sleep',async()=>{
 const before=(await api('/api/room?name=default')).data;
 const model=before.room.providers.codex.models[0].value;
 const bad=await api('/api/model',{room:'default',agent:'codex',model:'NOT_A_REAL_CATALOG_MODEL'});assert.equal(bad.status,400);
 const changed=await api('/api/model',{room:'default',agent:'codex',model});assert.equal(changed.status,200);
 assert.equal(changed.data.room.cfg.agents.codex.model,model);assert.equal(changed.data.room.adoptedMemory.version,1);assert.equal(changed.data.room.agents.claude.asleep,true);
 assert.ok(fs.readFileSync(path.join(roomDir,'events.jsonl'),'utf8').startsWith(originalEvents));
});
test('the next real adapter invocation receives memory plus recent context and omits old raw text',async()=>{
 const sent=await api('/api/message',{room:'default',target:'codex',text:'SAWWHAT'});assert.equal(sent.status,200);
 let result;
 for(let i=0;i<150;i++){
  result=(await api('/api/room?name=default')).data;
  if(!result.room.working&&!result.room.busy.length&&!result.room.queued&&result.entries.some(e=>e.kind==='agent'&&e.n>20))break;
  await new Promise(r=>setTimeout(r,80));
 }
 const answer=result.entries.filter(e=>e.kind==='agent'&&e.n>20).at(-1);assert.ok(answer,JSON.stringify(result.entries.filter(e=>e.kind==='system')));
 assert.match(answer.text,/MEMORY_ANCHOR/);assert.ok(!answer.text.includes('OMITTED_OLD_RAW'));assert.match(answer.text,/recent-dialogue-13/);
 assert.match(answer.text,/REVIEW_CORRECTION/);
 const status=(await api('/api/recorder/status?room=default')).data;assert.ok(status.pending>0);
 const blocked=await api('/api/recorder/continue',{room:'default'});assert.equal(blocked.status,400);assert.match(blocked.data.error,/整理/);
});
test('native adapters receive scoped automatic permissions while retaining the workspace sandbox',async()=>{
 let config=await api('/api/config',{room:'default',config:{mode:'work',agents:{codex:{sandbox:'workspace-write',autoApprove:true},claude:{permissionMode:'smart'}}}});assert.equal(config.status,200);
 const send=async agent=>{
  await api('/api/message',{room:'default',target:agent,text:'ARGJSON'});
  for(let i=0;i<150;i++){
   const snapshot=(await api('/api/room?name=default')).data;
   if(!snapshot.room.working&&!snapshot.room.busy.length&&!snapshot.room.queued){const answer=snapshot.entries.filter(e=>e.kind==='agent'&&e.author===agent).at(-1);if(answer)return JSON.parse(answer.text.replace(/^ARGVJSON /,''));}
   await new Promise(r=>setTimeout(r,50));
  }throw new Error('fake CLI did not answer');
 };
 const codex=await send('codex');assert.ok(codex.includes('approval_policy="never"'));assert.ok(codex.includes('workspace-write'));assert.ok(!codex.includes('danger-full-access'));
 await api('/api/seat/sleep',{room:'default',agent:'claude',asleep:false});
 const claude=await send('claude');assert.equal(claude[claude.indexOf('--permission-mode')+1],'auto');assert.ok(!claude.includes('bypassPermissions'));
});
test('source lookup and Markdown export work with the retained evidence',async()=>{
 const source=await api('/api/recorder/source?room=default&n=1');assert.equal(source.status,200);assert.match(source.data.text,/OMITTED_OLD_RAW/);
 const res=await fetch(base+'/api/recorder/export?room=default',{headers});assert.equal(res.status,200);assert.match(await res.text(),/MEMORY_ANCHOR/);
});
test('unconfigured summary call is explicit and makes no silent model fallback',async()=>{
 const result=await api('/api/recorder/summarize',{room:'default'});assert.equal(result.status,400);assert.match(result.data.error,/API Key/);
});
