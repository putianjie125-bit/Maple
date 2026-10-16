import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const app=path.dirname(path.dirname(fileURLToPath(import.meta.url))),temp=fs.mkdtempSync(path.join(app,'.reset-api-')),room=path.join(temp,'data','default'),audit=path.join(temp,'audit.json');fs.mkdirSync(room,{recursive:true});
const command=path.join(app,'test','fake-reset-cli.mjs');
fs.writeFileSync(path.join(temp,'data','.workspace-automation.json'),JSON.stringify({enabled:true}));
fs.writeFileSync(path.join(room,'room.json'),JSON.stringify({agents:{codex:{provider:'codex',command},claude:{provider:'claude',command}},hopBudget:0}));
const child=spawn(process.execPath,[path.join(app,'parley.mjs'),'--root',path.join(temp,'data'),'--port','0','--no-open'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PARLEY_TEST_RESET_STATE:audit,PARLEY_RECORDER_DIR:path.join(temp,'notes')}});
let output='',base='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
try{
 for(let i=0;i<100&&!base;i++){base=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0]||'';if(!base)await new Promise(r=>setTimeout(r,50));}
 assert.ok(base);const html=await(await fetch(base)).text();const headers={'X-Parley-Token':/name="parley-token" content="([^"]+)"/.exec(html)[1],'X-Parley-Runtime-Protocol':'12','Content-Type':'application/json'};
 test.after(()=>child.kill());
 test('reading quota never redeems a card; reset POST requires auth and explicit action',async()=>{
  const status=await(await fetch(base+'/api/quota',{headers})).json();assert.equal(status.codex.resetCredits.availableCount,3);assert.ok(!fs.existsSync(audit));
  assert.equal((await fetch(base+'/api/quota/reset',{method:'POST',body:'{}'})).status,403);
  assert.equal((await fetch(base+'/api/quota/reset',{method:'POST',headers,body:'{}'})).status,400);
  assert.equal((await fetch(base+'/api/quota/reset',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body:'{}'})).status,403);
 });
 test('new rooms inherit the approved workspace automation profile without full-machine bypass',async()=>{
  const created=await fetch(base+'/api/rooms',{method:'POST',headers,body:JSON.stringify({name:'workspace_profile',seats:['claude','codex']})});assert.equal(created.status,200);
  const snapshot=await(await fetch(base+'/api/room?name=workspace_profile',{headers})).json();assert.equal(snapshot.room.cfg.mode,'work');assert.equal(snapshot.room.cfg.agents.codex.sandbox,'workspace-write');assert.equal(snapshot.room.cfg.agents.codex.autoApprove,true);assert.equal(snapshot.room.cfg.agents.claude.permissionMode,'smart');
 });
 test('retrying the same reset request over HTTP consumes only one fake card',async()=>{
  const body=JSON.stringify({room:'default',action:'consume-one',idempotencyKey:randomUUID()});
  const first=await(await fetch(base+'/api/quota/reset',{method:'POST',headers,body})).json();assert.equal(first.outcome,'reset');assert.equal(first.codex.resetCredits.availableCount,2);
  const second=await(await fetch(base+'/api/quota/reset',{method:'POST',headers,body})).json();assert.equal(second.outcome,'alreadyRedeemed');assert.equal(second.codex.resetCredits.availableCount,2);
  assert.equal(JSON.parse(fs.readFileSync(audit)).used.length,1);
 });
}catch(e){child.kill();throw e;}
