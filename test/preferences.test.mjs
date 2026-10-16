import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {readPersonalPreferences} from '../lib/preferences.mjs';
import {createRecorder} from '../lib/recorder.mjs';
const temporary=fs.mkdtempSync(path.join(process.cwd(),'.preferences-test-'));
test('personal defaults are optional and cannot grant full-machine permissions or inject launch arguments',()=>{
 assert.deepEqual(readPersonalPreferences(temporary),{});
 fs.writeFileSync(path.join(temporary,'.personal-preferences.json'),JSON.stringify({schema:1,defaultProvider:'codex',hopBudget:2,roomNote:'PRIVATE_NOTE',sleepProviders:['claude','invalid'],agents:{codex:{model:'gpt-6.1-sol',effort:'medium',lurk:false,sandbox:'danger-full-access',extraArgs:['--dangerously-bypass-approvals-and-sandbox']}}}));
 const value=readPersonalPreferences(temporary);assert.equal(value.defaultProvider,'codex');assert.equal(value.agents.codex.effort,'medium');assert.equal(value.agents.codex.sandbox,undefined);assert.equal(value.agents.codex.extraArgs,undefined);assert.deepEqual(value.sleepProviders,['claude']);
 fs.writeFileSync(path.join(temporary,'.personal-preferences.json'),'{broken');assert.deepEqual(readPersonalPreferences(temporary),{});
});
test('new installs keep recorder files beneath their own data directory without a fixed D drive',()=>{
 const root=path.join(temporary,'generic');fs.mkdirSync(root);
 const recorder=createRecorder({root,saveState:()=>{},secretStore:{has:()=>false}});
 const room={name:'default',state:{},entries:[]};const result=recorder.status(room);
 assert.equal(result.recordDir,path.join(root,'.records'));assert.equal(result.hasKey,false);assert.ok(fs.existsSync(path.join(root,'.records','记忆状态.json')));recorder.close();
});
