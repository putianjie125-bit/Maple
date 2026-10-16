import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const temp=fs.mkdtempSync(path.join(app,'.quota-api-')),root=path.join(temp,'data'),room=path.join(root,'default');fs.mkdirSync(room,{recursive:true});
const fixture=path.join(app,'test','fake-quota-cli.mjs');
fs.writeFileSync(path.join(room,'room.json'),JSON.stringify({defaultAgent:'claude',mode:'talk',hopBudget:0,agents:{claude:{provider:'claude',command:fixture,extraArgs:[],lurk:false},codex:{provider:'codex',command:fixture,extraArgs:[],lurk:false,sandbox:'read-only'}}}));
const child=spawn(process.execPath,[path.join(app,'parley.mjs'),'--root',root,'--port','0','--no-open'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PARLEY_RECORDER_DIR:path.join(temp,'notes')}});
let output='',base='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
try{
 for(let i=0;i<100&&!base;i++){base=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0]||'';if(!base)await new Promise(r=>setTimeout(r,50));}
 assert.ok(base);const html=await(await fetch(base)).text();const token=/name="parley-token" content="([^"]+)"/.exec(html)[1];
 const headers={'X-Parley-Token':token,'X-Parley-Runtime-Protocol':'12'};
 test('quota API has existing auth protection and serves versioned assets',async()=>{
  assert.equal((await fetch(base+'/api/quota')).status,403);
  assert.equal((await fetch(base+'/api/quota',{headers:{...headers,Origin:'https://unrelated.example'}})).status,403);
  assert.match(html,/quota\.js\?v=/);assert.match(html,/模型额度/);
  const asset=/src="(\/ui\/quota\.js[^\"]+)"/.exec(html)[1];assert.equal((await fetch(base+asset)).status,200);
  assert.equal((await fetch(base+'/ui/quota.js?v=wrong')).status,409);
 });
 test('actual server returns percentages with unknown Claude and unconfigured DeepSeek',async()=>{
  const response=await fetch(base+'/api/quota?room=default',{headers});assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.codex.buckets[0].windows[0].remainingPercent,43);assert.equal(data.claude.windows.length,0);assert.equal(data.deepseek.state,'unconfigured');
  assert.equal(data.deepseek.balances.length,0);
 });
 test('a real Claude adapter stream captures quota reports without adding chat entries for quota',async()=>{
  const response=await fetch(base+'/api/message',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({room:'default',target:'claude',text:'fixture only'})});assert.equal(response.status,200);
  let snapshot;
  for(let i=0;i<100;i++){snapshot=await(await fetch(base+'/api/room?name=default',{headers})).json();if(snapshot.entries.some(e=>e.kind==='agent'))break;await new Promise(r=>setTimeout(r,50));}
  assert.equal(snapshot.entries.filter(e=>e.kind==='agent').length,1);
  const data=await(await fetch(base+'/api/quota?room=default',{headers})).json();assert.equal(data.claude.windows[0].remainingPercent,59);
  assert.equal(data.claude.windows[0].label,'5 小时额度');assert.equal(snapshot.room.cfg.agents.codex.sandbox,'read-only');
 });
 test.after(()=>child.kill());
}catch(e){child.kill();throw e;}
