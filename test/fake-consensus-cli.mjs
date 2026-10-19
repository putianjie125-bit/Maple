#!/usr/bin/env node
import fs from 'node:fs';
const args=process.argv.slice(2),codex=args.includes('exec'),model=codex?'codex':'claude';
let input='';for await(const chunk of process.stdin)input+=chunk;
const data=JSON.parse(input.trim().split('\n').at(-1));
if(data.originalTask.includes('CLI_FAIL')&&model==='claude')process.exit(2);
if(data.originalTask.includes('SLOW'))await new Promise(r=>setTimeout(r,15000));
const confirmation=data.phase==='confirmation';
const output=confirmation?{model,version:data.candidate.version,hash:data.candidate.hash,
  decision:data.originalTask.includes('REJECT')&&model==='claude'?'DISAGREE':'AGREE',reason:'模拟独立确认'}:
  {opinion:JSON.stringify({model,args,taskId:data.taskId,round:data.round,phase:data.phase,
    independent:!data.previousRounds.length&&!data.previousCandidates.length}),proposal:'模拟共同方案',disagreements:[]};
const text=JSON.stringify(output),out=obj=>process.stdout.write(JSON.stringify(obj)+'\n');
if(codex){
  out({type:'thread.started',thread_id:'test-consensus-codex'});
  out({type:'item.completed',item:{id:'result',type:'agent_message',text}});
  const file=args[args.indexOf('--output-last-message')+1];if(file)fs.writeFileSync(file,text);
}else out({type:'result',subtype:'success',result:text,session_id:'test-consensus-claude',is_error:false});
