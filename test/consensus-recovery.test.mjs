import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const app=fileURLToPath(new URL('../parley.mjs',import.meta.url));
const fake=fileURLToPath(new URL('./fake-consensus-cli.mjs',import.meta.url));
async function boot(root) {
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(SystemRoot|WINDIR|COMSPEC|PATHEXT|TEMP|TMP)$/i.test(key)));
  Object.assign(env,{HOME:root,USERPROFILE:root,APPDATA:root,LOCALAPPDATA:root,CODEX_HOME:root,CLAUDE_CONFIG_DIR:root,
    PATH:[path.dirname(process.execPath),...(process.platform==='win32'?[path.join(process.env.SystemRoot,'System32')]:['/usr/bin','/bin'])].join(path.delimiter)});
  const child=spawn(process.execPath,[app,'--root',path.join(root,'rooms'),'--port','0','--no-open'],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let output='';const base=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error(output)),10000);
    const read=chunk=>{output+=String(chunk);const match=/UI:\s+(http:\/\/127.0.0.1:\d+)/.exec(output);if(match){clearTimeout(timer);resolve(match[1]);}};
    child.stdout.on('data',read);child.stderr.on('data',read);child.on('error',reject);
    child.once('exit',code=>{clearTimeout(timer);reject(Error('Server exited '+code+output));});
  });
  const html=await fetch(base).then(r=>r.text());
  const headers={'Content-Type':'application/json','X-Parley-Token':/name="parley-token" content="([^"]+)"/.exec(html)[1],
    'X-Parley-Runtime-Protocol':/name="parley-runtime-protocol" content="([^"]+)"/.exec(html)[1]};
  return {async api(route,body){const res=await fetch(base+route,{headers,...(body?{method:'POST',body:JSON.stringify(body)}:{})});assert(res.ok,await res.clone().text());return res.json();},
    async close(){if(child.exitCode===null){const closed=new Promise(r=>child.once('close',r));child.kill();await closed;}}};
}
test('actual Maple process restart preserves valid success, marks interruption FAILED and leaves original chat intact',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'maple-restart-'));let server;
  t.after(async()=>{await server?.close();fs.rmSync(root,{recursive:true,force:true});});
  server=await boot(root);await server.api('/api/room?name=default');
  await server.api('/api/config',{room:'default',config:{agents:{codex:{command:fake},claude:{command:fake}}}});
  await server.api('/api/consensus/start',{question:'重启前共同方案',maxRounds:1});
  let first;for(let i=0;i<80;i++){const result=await server.api('/api/consensus');if(!result.active){first=result.task;break;}await new Promise(r=>setTimeout(r,30));}
  assert.equal(first.state,'CONSENSUS_REACHED');await server.close();
  const transcript=path.join(root,'rooms','default','events.jsonl'),old=fs.readFileSync(transcript,'utf8');
  server=await boot(root);let restored=await server.api('/api/consensus');assert.equal(restored.task.id,first.id);assert.equal(restored.task.state,'CONSENSUS_REACHED');
  assert.deepEqual(restored.task.finalResult,first.finalResult);assert.equal(fs.readFileSync(transcript,'utf8'),old);
  await server.close();
  // Simulate a hard crash snapshot between the two independent confirmations;
  // no real model is left running while this test restarts the server.
  const file=path.join(root,'rooms','default','consensus','tasks',first.id+'.json');
  first.state='PENDING_CONFIRMATION';first.finalResult=null;delete first.candidates[0].confirmations.claude;
  fs.writeFileSync(file,JSON.stringify(first));
  server=await boot(root);restored=await server.api('/api/consensus');
  assert.equal(restored.task.state,'FAILED');assert.equal(restored.task.finalResult,null);assert.equal(restored.active,false);
  assert.equal(restored.task.calls.length,4);assert.equal(fs.readFileSync(transcript,'utf8'),old);
  assert.equal((await server.api('/api/room?name=default')).room.working,false);
});
