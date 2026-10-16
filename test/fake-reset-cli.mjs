import fs from 'node:fs';
import readline from 'node:readline';
const file=process.env.PARLEY_TEST_RESET_STATE;if(!file)throw Error('Test fixture only');
if(process.argv.includes('app-server')){
 for await(const line of readline.createInterface({input:process.stdin})){
  const request=JSON.parse(line);if(request.method==='initialized')continue;
  const state=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{used:[],count:3};let result={};
  if(request.method==='account/rateLimitResetCredit/consume'){
   const key=request.params.idempotencyKey;if(state.used.includes(key))result={outcome:'alreadyRedeemed'};
   else if(!state.count)result={outcome:'noCredit'};
   else{state.used.push(key);state.count--;fs.writeFileSync(file,JSON.stringify(state));result={outcome:'reset'};}
  }else if(request.method==='account/rateLimits/read')result={rateLimits:{primary:{usedPercent:state.used.length?0:57,windowDurationMins:10080}},rateLimitResetCredits:{availableCount:state.count,credits:[]}};
  else if(request.method!=='initialize')throw Error('Unexpected method');
  console.log(JSON.stringify({id:request.id,result}));
 }
}else console.log(JSON.stringify({loggedIn:true}));
