import fs from 'node:fs';
import path from 'node:path';

// User-specific defaults live in the data directory, outside the distributable
// source. This profile does not grant permissions or contain credentials.
export function readPersonalPreferences(root){
  let raw;try{raw=JSON.parse(fs.readFileSync(path.join(root,'.personal-preferences.json'),'utf8'));}catch{return {};}
  if(raw?.schema!==1)return {};
  const result={agents:{}};
  if(['codex','claude','gemini'].includes(raw.defaultProvider))result.defaultProvider=raw.defaultProvider;
  if(Number.isSafeInteger(raw.hopBudget)&&raw.hopBudget>=0&&raw.hopBudget<=99)result.hopBudget=raw.hopBudget;
  if(typeof raw.roomNote==='string'&&raw.roomNote.length<=8000)result.roomNote=raw.roomNote;
  if(Number.isSafeInteger(raw.timeoutMs)&&raw.timeoutMs>=10000&&raw.timeoutMs<=3600000)result.timeoutMs=raw.timeoutMs;
  result.sleepProviders=Array.isArray(raw.sleepProviders)?raw.sleepProviders.filter(x=>['codex','claude','gemini'].includes(x)):[];
  for(const provider of ['codex','claude','gemini']){
    const input=raw.agents?.[provider];if(!input||typeof input!=='object')continue;
    const agent={};
    if(input.model===null||typeof input.model==='string'&&/^[a-zA-Z0-9._:/-]{1,120}$/.test(input.model))agent.model=input.model;
    if(input.effort===null||typeof input.effort==='string'&&/^[a-zA-Z0-9_-]{1,30}$/.test(input.effort))agent.effort=input.effort;
    if(typeof input.lurk==='boolean')agent.lurk=input.lurk;
    if(['quiet','balanced','vocal'].includes(input.lurkStyle))agent.lurkStyle=input.lurkStyle;
    result.agents[provider]=agent;
  }
  return result;
}
