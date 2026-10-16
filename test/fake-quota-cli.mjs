import readline from 'node:readline';
if(process.argv.includes('app-server')){
 const rl=readline.createInterface({input:process.stdin});
 for await(const line of rl){let request;try{request=JSON.parse(line);}catch{continue;}
  if(request.method==='initialize')console.log(JSON.stringify({id:request.id,result:{}}));
  else if(request.method==='account/rateLimits/read')console.log(JSON.stringify({id:request.id,result:{rateLimits:{primary:{usedPercent:57,windowDurationMins:10080,resetsAt:Math.floor(Date.now()/1000)+3600}}}}));
  else if(request.method!=='initialized'){console.log(JSON.stringify({id:request.id,error:{message:'Unexpected method'}}));process.exitCode=1;}
 }
}else if(process.argv.includes('auth'))console.log(JSON.stringify({loggedIn:true}));
else{
 for await(const _chunk of process.stdin){/* consume fake prompt */}
 console.log(JSON.stringify({type:'rate_limit_event',rate_limit_info:{status:'allowed_warning',rateLimitType:'five_hour',utilization:.41,resetsAt:Math.floor(Date.now()/1000)+10000}}));
 console.log(JSON.stringify({type:'result',result:'quota integration fixture',session_id:'quota-fixture',usage:{output_tokens:3}}));
}
