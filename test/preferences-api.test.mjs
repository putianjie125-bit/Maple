import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=path.dirname(path.dirname(fileURLToPath(import.meta.url))),temporary=fs.mkdtempSync(path.join(app,'.preferences-api-'));
async function start(name,personal){
 const root=path.join(temporary,name);fs.mkdirSync(root);
 if(personal){
  fs.writeFileSync(path.join(root,'.personal-preferences.json'),JSON.stringify({schema:1,defaultProvider:'codex',hopBudget:2,roomNote:'PRIVATE_DISCUSSION_NOTE',sleepProviders:['claude'],agents:{codex:{model:'gpt-6.1-sol',effort:'medium',lurk:false},claude:{model:'sonnet',lurk:false}}}));
  fs.mkdirSync(path.join(root,'existing'));fs.writeFileSync(path.join(root,'existing','room.json'),JSON.stringify({defaultAgent:'claude',hopBudget:7,roomNote:'EXISTING_NOTE',agents:{claude:{provider:'claude',model:'opus'},codex:{provider:'codex',model:'gpt-6-luna',effort:'high'}}}));
 }
 const child=spawn(process.execPath,[path.join(app,'parley.mjs'),'--root',root,'--port','0','--no-open'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PARLEY_RECORDER_DIR:path.join(root,'.records')}});
 let output='',base='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
 try{
  for(let i=0;i<100&&!base;i++){base=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0]||'';if(!base)await new Promise(r=>setTimeout(r,50));}
  assert.ok(base);const html=await(await fetch(base)).text();const headers={'X-Parley-Token':/name="parley-token" content="([^"]+)"/.exec(html)[1],'X-Parley-Runtime-Protocol':'12'};
  return {root,child,api:async route=>await(await fetch(base+route,{headers})).json()};
 }catch(e){child.kill();throw e;}
}
const [general,personal]=await Promise.all([start('general',false),start('personal',true)]);test.after(()=>{general.child.kill();personal.child.kill();});
test('public defaults allow two extra exchanges without shipping a personal model, note or approval profile',async()=>{
 const {room}=await general.api('/api/room?name=default');assert.equal(room.cfg.hopBudget,2);assert.equal(room.cfg.roomNote,null);assert.equal(room.cfg.agents.codex.model,null);assert.equal(room.cfg.mode,'talk');assert.equal(room.cfg.agents.codex.sandbox,'read-only');
});
test('a local profile chooses the main agent and pauses unconfigured Claude without replacing existing room choices',async()=>{
 const {room}=await personal.api('/api/room?name=default');assert.equal(room.cfg.defaultAgent,'codex');assert.equal(room.cfg.agents.codex.model,'gpt-6.1-sol');assert.equal(room.cfg.agents.codex.effort,'medium');assert.equal(room.agents.claude.asleep,true);assert.equal(room.agents.codex.asleep,false);assert.equal(room.cfg.roomNote,'PRIVATE_DISCUSSION_NOTE');
 const old=(await personal.api('/api/room?name=existing')).room;assert.equal(old.cfg.hopBudget,7);assert.equal(old.cfg.agents.codex.model,'gpt-6-luna');assert.equal(old.cfg.agents.codex.effort,'high');assert.equal(old.cfg.roomNote,'EXISTING_NOTE');
 await personal.api('/api/recorder/status?room=default');const names=(await personal.api('/api/rooms')).rooms.map(r=>r.name);assert.ok(!names.includes('.records'));
});
