import {spawn} from 'node:child_process';

const finite=value=>typeof value==='number'&&Number.isFinite(value);
const timestamp=value=>finite(value)&&value>0?value:null;
const clean=value=>typeof value==='string'?value.slice(0,100):null;
export function quotaWindow(value,label,now=Date.now()) {
  if(!value||typeof value!=='object')return null;
  const resetsAt=timestamp(value.resetsAt);
  const used=finite(value.usedPercent)?Math.max(0,Math.min(100,value.usedPercent)):null;
  const expired=resetsAt!==null&&resetsAt*1000<=now;
  const duration=value.windowDurationMins;
  if(finite(duration)&&duration>0)label=duration===10080?'每周额度':duration>=1440&&duration%1440===0?`${duration/1440} 天额度`:duration>=60&&duration%60===0?`${duration/60} 小时额度`:`${duration} 分钟额度`;
  return {label,remainingPercent:used===null||expired?null:Math.round((100-used)*10)/10,
    resetsAt,windowDurationMins:finite(value.windowDurationMins)&&value.windowDurationMins>0?value.windowDurationMins:null,expired};
}
export function normalizeCodex(result,now=Date.now()) {
  const multiple=result?.rateLimitsByLimitId;
  const entries=multiple&&typeof multiple==='object'&&Object.keys(multiple).length
    ?Object.entries(multiple).slice(0,32):result?.rateLimits?[['codex',result.rateLimits]]:[];
  return entries.filter(([,v])=>v&&typeof v==='object').map(([id,value])=>({
    id:clean(value.limitId)||clean(id),name:clean(value.limitName)||(id==='codex'?'通用额度':clean(id)),
    windows:[quotaWindow(value.primary,'短期额度',now),quotaWindow(value.secondary,'长期额度',now)].filter(Boolean),
  }));
}

export function resetCredits(result){
  const value=result?.rateLimitResetCredits;
  if(!value||!Number.isSafeInteger(value.availableCount)||value.availableCount<0)return {availableCount:null,credits:[]};
  return {availableCount:value.availableCount,credits:Array.isArray(value.credits)?value.credits.slice(0,100).filter(c=>c&&typeof c.id==='string'&&c.id.length<200&&c.status==='available').map(c=>({id:c.id,expiresAt:timestamp(c.expiresAt),title:clean(c.title)})).sort((a,b)=>(a.expiresAt||Infinity)-(b.expiresAt||Infinity)):[]};
}
// Metadata-only RPC, plus an explicitly requested reset redemption. Never
// create model turns or inspect authentication files.
function codexRpc(spec,steps,{spawnImpl=spawn,timeoutMs=18000}={}) {
  return new Promise((resolve,reject)=>{
    if(!spec?.cmd||spec.error||spec.via==='cmdshell')return reject(new Error('未找到可查询额度的 Codex 程序。'));
    let child,done=false,buffer='',bytes=0,step=0;const results=[];
    const finish=(error,result)=>{
      if(done)return;done=true;clearTimeout(timer);
      if(child){child.stdin.end();child.kill();}
      error?reject(new Error(error)):resolve(result);
    };
    const timer=setTimeout(()=>finish('Codex 额度查询超时，请稍后刷新。'),timeoutMs);
    try{child=spawnImpl(spec.cmd,[...(spec.pre||[]),'app-server','--listen','stdio://'],{windowsHide:true,stdio:['pipe','pipe','pipe']});}
    catch{return finish('无法启动 Codex 额度查询。');}
    child.stderr.resume();child.stdout.setEncoding('utf8');
    child.on('error',()=>finish('无法启动 Codex 额度查询。'));
    child.on('close',()=>finish('Codex 未返回额度，请确认已登录。'));
    child.stdin.on('error',()=>finish('Codex 额度查询连接中断。'));
    const send=value=>{if(!done)child.stdin.write(JSON.stringify(value)+'\n');};
    child.stdout.on('data',chunk=>{
      if(done)return;bytes+=Buffer.byteLength(chunk);
      if(bytes>2*1024*1024)return finish('Codex 额度响应过大，已停止读取。');
      buffer+=chunk;
      let end;while(!done&&(end=buffer.indexOf('\n'))!==-1){
        const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;
        try{message=JSON.parse(line);}catch{continue;}
        if(message.id===1){
          if(message.error)return finish('当前 Codex 版本无法读取额度，请更新后重试。');
          send({method:'initialized'});send({id:2,...steps[0]});
        }else if(message.id===step+2){
          if(message.error)return finish('未获取 Codex 额度，请确认登录方式和网络。');
          results.push(message.result);step++;
          if(step<steps.length)send({id:step+2,...steps[step]});
          else finish(null,results);
        }
      }
    });
    send({id:1,method:'initialize',params:{clientInfo:{name:'parley_quota',title:'Parley 额度查询',version:'1.0.0'},capabilities:{experimentalApi:false}}});
  });
}
export async function readCodexLimits(spec,options={}){
  const [result]=await codexRpc(spec,[{method:'account/rateLimits/read'}],options);
  const now=(options.now||Date.now)();
  const buckets=normalizeCodex(result,now);
  if(!buckets.some(b=>b.windows.length))throw new Error('此账号暂未返回可用的额度百分比。');
  return {buckets,resetCredits:resetCredits(result),updatedAt:new Date(now).toISOString()};
}
export async function consumeCodexReset(spec,request,options={}){
  const {idempotencyKey,creditId}=request;
  if(typeof idempotencyKey!=='string'||!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(idempotencyKey))throw new Error('重置请求编号无效。');
  if(creditId!==undefined&&(typeof creditId!=='string'||!/^RateLimitResetCredit_[a-zA-Z0-9_-]{1,160}$/.test(creditId)))throw new Error('重置卡编号无效。');
  const [consumed,result]=await codexRpc(spec,[{method:'account/rateLimitResetCredit/consume',params:{idempotencyKey,...(creditId?{creditId}:{})}},{method:'account/rateLimits/read'}],options);
  if(!['reset','alreadyRedeemed','nothingToReset','noCredit'].includes(consumed?.outcome))throw new Error('重置结果未知，请刷新额度；重试时请保留原请求编号。');
  const now=(options.now||Date.now)();
  return {outcome:consumed.outcome,buckets:normalizeCodex(result,now),resetCredits:resetCredits(result),updatedAt:new Date(now).toISOString()};
}

const claudeLabels={five_hour:'5 小时额度',seven_day:'每周额度',seven_day_opus:'Opus 每周额度',seven_day_sonnet:'Sonnet 每周额度'};
export function claudeObservation(info,now=Date.now()) {
  if(!info||typeof info!=='object'||!['allowed','allowed_warning','rejected'].includes(info.status))return null;
  const type=Object.hasOwn(claudeLabels,info.rateLimitType)?info.rateLimitType:'unknown';
  const utilization=finite(info.utilization)&&info.utilization>=0&&info.utilization<=1?info.utilization:null;
  return {type,label:claudeLabels[type]||'账号额度',usedPercent:utilization===null?null:utilization*100,
    resetsAt:timestamp(info.resetsAt),status:info.status,updatedAt:new Date(now).toISOString()};
}

export function createQuota({resolveCommand,recorder,readCodex=readCodexLimits,consumeReset=consumeCodexReset,now=Date.now}) {
  const cache=new Map(),inflight=new Map(),resetting=new Map();
  async function codex(command,force){
    const previous=cache.get(command),age=previous?now()-previous.at:Infinity;
    if(previous&&age<(force?10000:60000))return previous.value;
    if(inflight.has(command))return inflight.get(command);
    const pending=(async()=>{
      let value;
      try{value={...await readCodex(resolveCommand(command)),error:null,stale:false};}
      catch{value={buckets:[],updatedAt:null,error:'暂未获取 Codex 额度，请检查登录和网络后刷新。',stale:false};}
      cache.set(command,{at:now(),value});return value;
    })();
    inflight.set(command,pending);try{return await pending;}finally{inflight.delete(command);}
  }
  async function status(room,{force=false}={}) {
    const seats=Object.entries(room.cfg.agents);
    const codexSeat=seats.find(([,cfg])=>cfg.provider==='codex');
    const claudeSeats=seats.filter(([,cfg])=>cfg.provider==='claude');
    const [codexData,deepseek]=await Promise.all([
      codexSeat?codex(codexSeat[1].command||'codex',force):Promise.resolve({buckets:[],error:'本聊天室未配置 Codex。',updatedAt:null}),
      recorder.balance({force}),
    ]);
    const claudeWindows=[];
    for(const [seat]of claudeSeats){
      const observations=room.state.quotaClaude?.[seat]||{};
      for(const observation of Object.values(observations)){
        const window=quotaWindow(observation,observation.label,now());
        if(window)claudeWindows.push({...window,seat,updatedAt:observation.updatedAt,
          stale:now()-Date.parse(observation.updatedAt)>5*60*1000});
      }
    }
    return {codex:{...codexData,models:codexSeat?[codexSeat[1].model||'默认模型']:[],scope:'账号共享'},
      claude:{windows:claudeWindows,models:claudeSeats.map(([,cfg])=>cfg.model||'默认模型'),
        error:claudeWindows.length?null:'尚未获取。Claude 后续回复若返回额度信息，会自动更新。',scope:'账号共享'},
      deepseek,checkedAt:new Date(now()).toISOString()};
  }
  async function reset(room,request){
    const seat=Object.values(room.cfg.agents).find(cfg=>cfg.provider==='codex');
    if(!seat)throw Object.assign(new Error('本聊天室没有 Codex。'),{status:400});
    const command=seat.command||'codex';
    if(resetting.has(command))throw Object.assign(new Error('已有重置请求正在处理，请等待。'),{status:409});
    const pending=(async()=>{
      try{
        const result=await consumeReset(resolveCommand(command),request);
        const {outcome,...value}=result;
        // An older in-flight read must not replace the post-redemption result.
        const old=inflight.get(command);if(old)await old.catch(()=>{});
        cache.set(command,{at:now(),value:{...value,error:null,stale:false}});
        return {outcome,...await status(room)};
      }catch(e){cache.delete(command);throw Object.assign(new Error(e.message||'重置请求失败，请保留原请求编号重试。'),{status:502});}
    })();
    resetting.set(command,pending);try{return await pending;}finally{resetting.delete(command);}
  }
  return {status,reset};
}
