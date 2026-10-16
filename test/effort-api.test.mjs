import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const app=path.dirname(path.dirname(fileURLToPath(import.meta.url))),root=fs.mkdtempSync(path.join(app,'.effort-api-')),roomDir=path.join(root,'default');
fs.mkdirSync(roomDir);
fs.writeFileSync(path.join(roomDir,'room.json'),JSON.stringify({defaultAgent:'codex',hopBudget:2,agents:{codex:{provider:'codex',effort:'medium',sandbox:'read-only'},claude:{provider:'claude',effort:'medium'}}}));
fs.writeFileSync(path.join(roomDir,'state.json'),JSON.stringify({nextTurn:1,agents:{codex:{cursor:0,sessionRef:'old-codex-session'},claude:{cursor:0,sessionRef:'claude-session',permissionScope:'default',asleep:{since:'2026-10-16',reason:'user sleep'}}}}));
const child=spawn(process.execPath,[path.join(app,'parley.mjs'),'--root',root,'--port','0','--no-open'],{cwd:app,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PARLEY_RECORDER_DIR:path.join(root,'.records')}});
let output='',base='';child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
try{
 for(let i=0;i<100&&!base;i++){base=/http:\/\/127\.0\.0\.1:\d+/.exec(output)?.[0]||'';if(!base)await new Promise(r=>setTimeout(r,50));}
 assert.ok(base);const html=await(await fetch(base)).text(),headers={'X-Parley-Token':/name="parley-token" content="([^"]+)"/.exec(html)[1],'X-Parley-Runtime-Protocol':'12','Content-Type':'application/json'};
 const api=async body=>{const response=await fetch(base+'/api/model',{method:'POST',headers,body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
 test.after(()=>child.kill());
 test('effort-only changes reset only the selected session while preserving room settings and sleep',async()=>{
  const response=await api({agent:'codex',effort:'high'});assert.equal(response.status,200);
  assert.equal(response.body.room.cfg.agents.codex.effort,'high');assert.equal(response.body.room.cfg.agents.codex.model,null);assert.equal(response.body.room.cfg.hopBudget,2);assert.equal(response.body.room.cfg.agents.codex.sandbox,'read-only');
  const saved=JSON.parse(fs.readFileSync(path.join(roomDir,'state.json')));assert.equal(saved.agents.codex.sessionRef,null);assert.equal(saved.agents.claude.sessionRef,'claude-session');assert.ok(saved.agents.claude.asleep);
 });
 test('unsupported effort is rejected before any model or effort is changed',async()=>{
  const before=await(await fetch(base+'/api/room?name=default',{headers})).json();const model=before.room.providers.codex.models[0];
  const response=await api({agent:'codex',model:model.value,effort:'invented-level'});assert.equal(response.status,400);
  const after=await(await fetch(base+'/api/room?name=default',{headers})).json();assert.deepEqual(after.room.cfg,before.room.cfg);
  const supported=model.efforts?.length?model.efforts:before.room.providers.codex.efforts.map(e=>e.value);
  assert.equal((await api({agent:'codex',model:model.value,effort:supported[0]})).status,200);
 });
 test('effort writes require the session token and reject cross-origin requests',async()=>{
  assert.equal((await fetch(base+'/api/model',{method:'POST',body:JSON.stringify({agent:'codex',effort:'high'})})).status,403);
  assert.equal((await fetch(base+'/api/model',{method:'POST',headers:{...headers,Origin:'https://unrelated.example'},body:JSON.stringify({agent:'codex',effort:'high'})})).status,403);
 });
 test('font and theme assets share the page version and reject stale asset URLs',async()=>{
  const cssUrl=/href="([^"]+maple\.css[^"]+)"/.exec(html)[1],cssResponse=await fetch(base+cssUrl);assert.equal(cssResponse.status,200);const css=await cssResponse.text();assert.ok(!css.includes('__PARLEY_ASSET_VERSION__'));
  const fontUrl=/url\('([^']+SourceHan[^']+)'\)/.exec(css)[1];const font=await fetch(base+fontUrl);assert.equal(font.status,200);assert.equal(font.headers.get('content-type'),'font/woff2');assert.ok((await font.arrayBuffer()).byteLength>100000);
  assert.equal((await fetch(base+'/ui/fonts/SourceHanSerifSC-VF.woff2?v=stale')).status,409);
  assert.equal((await fetch(base+'/ui/fonts/../../.recorder/deepseek-key.dpapi')).status,403);
 });
}catch(error){child.kill();throw error;}
