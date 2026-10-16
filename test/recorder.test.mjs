import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRecorder,windowsSecretStore} from '../lib/recorder.mjs';

const TEMP=fs.mkdtempSync(path.join(process.cwd(),'.recorder-test-'));
const secretKey='sk-synthetic-test-value-not-a-real-key';
const fixture=(n,kind,text,extra={})=>({n,kind,text,author:kind==='user'?'user':'codex',target:kind==='user'?'codex':null,ts:'2026-10-16T12:00:00',...extra});
function setup(name,fetchImpl){
 const dir=path.join(TEMP,name);fs.mkdirSync(dir,{recursive:true});
 let key=secretKey;
 const store={has:()=>!!key,get:async()=>key,set:async x=>{key=x;},remove:async()=>{key='';}};
 const room={name:'default',dir,state:{agents:{codex:{cursor:0,sessionRef:'old'},claude:{cursor:0,sessionRef:'old'}},cancelledDeliveries:{}},entries:[fixture(1,'user','我决定保留原文。'),fixture(2,'agent','建议每十条整理一次，尚未决定。')]};
 const recordDir=path.join(dir,'notes'),recordPath=path.join(recordDir,'记忆状态.json');
 const service=createRecorder({root:dir,defaultPath:recordDir,secretStore:store,fetchImpl,saveState:()=>{}});
 return {dir,room,recordDir,recordPath,service,store};
}
function data(){return {goal:'建立项目记忆',constraints:[{text:'保留原文',sources:[1]}],decisions:[{text:'用户决定保留原文',sources:[1],user_source:1,user_quote:'我决定保留原文。'}],view_changes:[],open_questions:[{text:'整理频率仍待确认',sources:[2]}],next_steps:[]};}
function response(content=data(),extra={}){return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:typeof content==='string'?content:JSON.stringify(content)}}],usage:{prompt_tokens:10,completion_tokens:20},...extra})};}

test('one folder contains separate readable raw dialogue and recovered memory, without the key',async()=>{
 const t=setup('round-trip',async()=>response());
 await t.service.summarize(t.room);
 const section=JSON.parse(fs.readFileSync(t.recordPath,'utf8')).sections[0];
 const text=fs.readFileSync(path.join(t.recordDir,section.folder,'原始对话.md'),'utf8');
 assert.match(text,/原始对话/);assert.match(text,/我决定保留原文/);assert.ok(!text.includes(secretKey));
 assert.match(fs.readFileSync(path.join(t.recordDir,section.folder,'项目记忆.md'),'utf8'),/已明确采纳的决定/);
 const restored=createRecorder({root:t.dir,defaultPath:t.recordDir,secretStore:t.store,saveState:()=>{}});
 assert.equal(restored.status(t.room).memory.version,1);
 assert.equal(restored.status(t.room).memory.data.decisions[0].user_source,1);
 assert.deepEqual(fs.readdirSync(t.dir),['notes']);
 t.service.close();restored.close();
});
test('uses fixed official Flash endpoint, JSON mode and no tools',async()=>{
 let seen;const t=setup('wire',async(url,request)=>{seen={url,request};return response();});
 await t.service.summarize(t.room);
 assert.equal(seen.url,'https://api.deepseek.com/chat/completions');
 const body=JSON.parse(seen.request.body);assert.equal(body.model,'deepseek-flash');assert.equal(body.response_format.type,'json_object');assert.equal(body.thinking.type,'disabled');assert.equal(body.tools,undefined);assert.equal(seen.request.redirect,'error');
 assert.ok(!JSON.stringify(t.service.status(t.room)).includes(secretKey));t.service.close();
});
test('missing key and provider authentication errors never expose credentials',async()=>{
 const t=setup('auth',async()=>({ok:false,status:401,json:async()=>({error:'secret '+secretKey})}));
 await assert.rejects(t.service.summarize(t.room),/Key 无效/);
 await t.store.remove();await assert.rejects(t.service.summarize(t.room),/请先/);
 assert.equal(t.service.status(t.room).memory,null);assert.ok(!fs.readFileSync(t.recordPath,'utf8').includes(secretKey));t.service.close();
});
test('invalid JSON, unsupported citations and non-user adoption leave the last valid memory intact',async()=>{
 let reply=response();const t=setup('validation',async()=>reply);await t.service.summarize(t.room);
 t.room.entries.push(fixture(3,'user','还没有决定整理频率。'));
 reply=response('{bad json');await assert.rejects(t.service.summarize(t.room),/JSON/);
 const bad=data();bad.open_questions[0].sources=[999];reply=response(bad);await assert.rejects(t.service.summarize(t.room),/引用/);
 const noUser=data();noUser.decisions[0].user_source=2;noUser.decisions[0].sources=[2];noUser.decisions[0].user_quote='建议';reply=response(noUser);await assert.rejects(t.service.summarize(t.room),/用户原话/);
 reply=response(data(),{choices:[{finish_reason:'length',message:{content:'{}'}}]});await assert.rejects(t.service.summarize(t.room),/完整/);
 assert.equal(t.service.status(t.room).memory.version,1);assert.equal(t.service.status(t.room).pending,1);t.service.close();
});
test('only new messages plus cited old evidence are sent on the next update',async()=>{
 const seen=[];const t=setup('incremental',async(url,req)=>{seen.push(JSON.parse(JSON.parse(req.body).messages[1].content));return response();});
 await t.service.summarize(t.room);t.room.entries.push(fixture(3,'user','继续保留原文。'));await t.service.summarize(t.room);
 assert.deepEqual(seen[1].new_messages.map(x=>x.n),[3]);assert.deepEqual(seen[1].previous_source_evidence.map(x=>x.n),[1,2]);assert.equal(t.service.status(t.room).memory.version,2);t.service.close();
});
test('dialogue arriving during summary remains pending and cannot be silently compacted',async()=>{
 let release;const t=setup('concurrent',()=>new Promise(resolve=>{release=()=>resolve(response());}));
 const pending=t.service.summarize(t.room);pending.catch(()=>{});let spins=0;while(!release){if(++spins>100)await pending;await new Promise(r=>setTimeout(r,1));}
 await assert.rejects(t.service.summarize(t.room),/正在整理/);
 await assert.rejects(t.service.settings({apiKey:secretKey}),/正在处理/);
 t.room.entries.push(fixture(3,'user','一个新问题。'));release();await pending;
 assert.equal(t.service.status(t.room).pending,1);assert.throws(()=>t.service.prepareContinue(t.room),/新对话/);t.service.close();
});
test('withheld user text and its rooted reply never enter shared memory',async()=>{
 let input;const t=setup('withheld',async(url,req)=>{input=JSON.parse(JSON.parse(req.body).messages[1].content);return response();});
 t.room.entries.push(fixture(3,'user','PRIVATE_WITHHELD'));t.room.entries.push(fixture(4,'agent','PRIVATE_REPLY',{meta:{delivery:{rootN:3}}}));t.room.state.cancelledDeliveries['3']=['claude'];
 await t.service.summarize(t.room);assert.ok(!JSON.stringify(input).includes('PRIVATE'));assert.match(fs.readFileSync(t.recordPath,'utf8'),/PRIVATE_WITHHELD/);t.service.close();
});
test('changed withdrawal state invalidates a summary and requires a fresh rebuild',async()=>{
 const t=setup('withdrawal-change',async()=>response());await t.service.summarize(t.room);
 t.room.state.cancelledDeliveries['1']=['claude'];assert.equal(t.service.status(t.room).needsRebuild,true);assert.throws(()=>t.service.prepareContinue(t.room),/撤回状态/);t.service.close();
});
test('compaction preserves original messages, receipts and permissions; retains a bounded recent tail',async()=>{
 const t=setup('compaction',async()=>response());for(let n=3;n<=20;n++)t.room.entries.push(fixture(n,n%2?'user':'agent','历史内容 '+n));
 const original=JSON.stringify(t.room.entries);await t.service.summarize(t.room);const context=t.service.prepareContinue(t.room);
 assert.equal(context.floorN,12);assert.equal(context.throughN,20);assert.equal(JSON.stringify(t.room.entries),original);
 t.room.state.recorderContext=context;assert.match(t.service.context(t.room),/project-memory \|/);assert.match(t.service.context(t.room),/保留原文/);assert.equal(t.room.state.agents.codex.sessionRef,'old');t.service.close();
});
test('a failed disk commit keeps the in-memory last good summary',async()=>{
 const t=setup('disk-conflict',async()=>response());await t.service.summarize(t.room);t.room.entries.push(fixture(3,'user','继续。'));
 fs.appendFileSync(t.recordPath,'\n外部修改\n');await assert.rejects(t.service.summarize(t.room),/其他程序修改/);assert.equal(t.service.status(t.room).memory.version,1);t.service.close();
});
test('existing unrelated files are never overwritten and key settings do not echo key contents',async()=>{
 const t=setup('settings',async()=>response());t.service.sync(t.room);const other=path.join(t.dir,'other.md');fs.writeFileSync(other,'DO NOT OVERWRITE');
 await assert.rejects(t.service.settings({recordDir:other}),/文件夹/);assert.equal(fs.readFileSync(other,'utf8'),'DO NOT OVERWRITE');
 const result=await t.service.settings({apiKey:secretKey});assert.ok(!JSON.stringify(result).includes(secretKey));await t.service.settings({removeKey:true});assert.equal(t.service.status(t.room).hasKey,false);t.service.close();
});
test('connection test only queries official models, without sending dialogue',async()=>{
 let seen;const t=setup('models',async(url,req)=>{seen={url,req};return {ok:true,json:async()=>({data:[{id:'deepseek-flash'}]})};});
 await t.service.testConnection();assert.equal(seen.url,'https://api.deepseek.com/models');assert.equal(seen.req.method,'GET');assert.equal(seen.req.body,undefined);t.service.close();
});
test('Windows DPAPI encrypts locally and can round-trip a synthetic key', {skip:process.platform!=='win32'},async()=>{
 const dir=path.join(TEMP,'dpapi'),store=windowsSecretStore(dir);await store.set(secretKey);assert.equal(await store.get(),secretKey);assert.ok(!fs.readFileSync(path.join(dir,'deepseek-key.dpapi'),'utf8').includes(secretKey));await store.remove();assert.equal(store.has(),false);
});
