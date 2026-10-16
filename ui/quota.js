(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const headers={'X-Parley-Token':document.querySelector('meta[name="parley-token"]').content,'X-Parley-Runtime-Protocol':document.querySelector('meta[name="parley-runtime-protocol"]').content};
  const currentRoom=()=>window.parleyRecorderHost.getRoom();
  let last=null,shownRoom=null,working=false,resetting=false;
  const dialog=document.createElement('dialog');dialog.id='quotaDialog';dialog.setAttribute('aria-labelledby','quotaTitle');
  dialog.innerHTML=`<div class="q-head"><div><h2 id="quotaTitle">模型额度</h2><p>账号额度与余额，一眼看清</p></div><button id="quotaClose" type="button" aria-label="关闭模型额度">✕</button></div>
    <div class="q-grid"><section class="q-card q-codex"><div class="q-provider"><span class="q-avatar">X</span><h3>Codex</h3><span class="q-tag">剩余百分比</span></div><div id="quotaCodex"></div></section>
    <section class="q-card q-claude"><div class="q-provider"><span class="q-avatar">C</span><h3>Claude</h3><span class="q-tag">剩余百分比</span></div><div id="quotaClaude"></div></section>
    <section class="q-card q-deepseek"><div class="q-provider"><span class="q-avatar">D</span><h3>DeepSeek</h3><span class="q-tag">账户余额</span></div><div id="quotaDeepseek"></div></section></div>
    <div class="q-footer"><span id="quotaTime" role="status">正在读取…</span><button id="quotaRefresh" type="button">刷新额度</button></div>
    <p id="quotaActionStatus" class="q-explain" role="status" aria-live="polite"></p>
    <p class="q-note">账号共享的额度按账号显示。页面打开时每分钟更新；查询不会发消息或调用付费模型。</p>`;
  document.body.append(dialog);
  function node(tag,className,text){const element=document.createElement(tag);element.className=className||'';if(text!==undefined)element.textContent=text;return element;}
  const percent=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100;
  function number(value){return value.toLocaleString('zh-CN',{maximumFractionDigits:1});}
  function date(value){const time=new Date(value);return Number.isFinite(time.getTime())?time.toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}):'时间未知';}
  function empty(box,text){box.append(node('div','q-unknown','—'),node('p','q-explain',text||'暂未获取'));}
  function windowRow(box,window){
    const row=node('div','q-window');row.append(node('div','q-label',window.label));
    if(percent(window.remainingPercent)){
      const value=node('div','q-value',number(window.remainingPercent));value.append(node('span','q-percent','%'),node('span','q-remaining','剩余'));row.append(value);
      const bar=node('div','q-bar');bar.setAttribute('role','progressbar');bar.setAttribute('aria-label',window.label+'剩余额度');bar.setAttribute('aria-valuemin','0');bar.setAttribute('aria-valuemax','100');bar.setAttribute('aria-valuenow',window.remainingPercent);
      const fill=node('div','q-fill');fill.style.width=window.remainingPercent+'%';if(window.remainingPercent<=10)fill.classList.add('q-low');else if(window.remainingPercent<=25)fill.classList.add('q-warn');bar.append(fill);row.append(bar);
    }else row.append(node('div','q-window-unknown','未获取'));
    if(window.resetsAt)row.append(node('p','q-detail',window.expired?'已到重置时间，等待最新报告':'重置于 '+date(window.resetsAt*1000)));
    if(window.updatedAt)row.append(node('p','q-detail',(window.stale?'历史报告 · ':'上次报告 · ')+date(window.updatedAt)));
    box.append(row);
  }
  function miniValue(windows){
    const values=windows.filter(w=>!w.stale&&percent(w.remainingPercent)).map(w=>w.remainingPercent);
    return values.length?number(Math.min(...values))+'%':'未获取';
  }
  function money(row){const value=Number(row.total);return (row.currency==='CNY'?'¥':'$')+value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:4});}
  function render(data){
    const codex=$('quotaCodex'),claude=$('quotaClaude'),deepseek=$('quotaDeepseek');codex.replaceChildren();claude.replaceChildren();deepseek.replaceChildren();
    const windows=data.codex.buckets.flatMap(b=>b.windows);
    if(windows.length){for(const bucket of data.codex.buckets){if(data.codex.buckets.length>1)codex.append(node('h4','q-bucket',bucket.name));for(const window of bucket.windows)windowRow(codex,window);}}
    else empty(codex,data.codex.error);
    const credits=data.codex.resetCredits;
    const resetBox=node('div','q-reset-box');
    resetBox.append(node('div','q-label',Number.isSafeInteger(credits?.availableCount)?`可用重置卡：${credits.availableCount} 张`:'重置卡数量暂未获取'));
    if(credits?.credits?.[0]?.expiresAt)resetBox.append(node('p','q-detail','最早到期 '+date(credits.credits[0].expiresAt*1000)));
    let pendingReset=null;try{pendingReset=JSON.parse(sessionStorage.getItem('parley-reset-pending')||'null');}catch{}
    const resetButton=node('button','q-reset-button',pendingReset?.idempotencyKey?'重试这次重置':'消耗一张并重置');resetButton.id='quotaReset';resetButton.type='button';resetButton.disabled=resetting||!(credits?.availableCount>0||pendingReset?.idempotencyKey);resetBox.append(resetButton,node('p','q-detail','手动使用，消耗后不可撤销。'));codex.append(resetBox);
    if(data.claude.windows.length)for(const window of data.claude.windows)windowRow(claude,window);
    else empty(claude,data.claude.error);
    const accountLink=node('a','q-link','前往 Claude 官方重置 / 用量 ↗');accountLink.href='https://claude.ai/settings/usage';accountLink.target='_blank';accountLink.rel='noopener noreferrer';claude.append(accountLink,node('p','q-detail','若账户获赠重置权益，请在官方页面使用。'));
    if(data.deepseek.state==='ready'){
      for(const row of data.deepseek.balances){deepseek.append(node('div','q-label',row.currency==='CNY'?'人民币可用余额':'美元可用余额'),node('div','q-money',money(row)));}
      if(data.deepseek.available===false)deepseek.append(node('p','q-explain','当前余额不可用于调用，请查看官方账户。'));
      deepseek.append(node('p','q-detail','更新于 '+date(data.deepseek.updatedAt)));
    }else empty(deepseek,data.deepseek.error);
    $('quotaMiniCodex').textContent=miniValue(windows);$('quotaMiniCodex').title='多个额度窗口时显示最低剩余百分比';
    $('quotaMiniClaude').textContent=miniValue(data.claude.windows);$('quotaMiniClaude').title='以 Claude 最近返回的账号报告为准，旧报告请打开面板查看';
    $('quotaMiniDeepseek').textContent=data.deepseek.state==='ready'?data.deepseek.balances.map(money).join(' / '):'未获取';
    $('quotaTime').textContent='更新于 '+date(data.checkedAt);
  }
  async function refresh(force=false){
    if(working||resetting)return;working=true;$('quotaRefresh').disabled=true;$('quotaTime').textContent='正在读取…';
    const room=currentRoom();
    try{
      const response=await fetch('/api/quota?room='+encodeURIComponent(room)+(force?'&refresh=1':''),{headers});
      if(!response.ok)throw new Error();const data=await response.json();
      if(currentRoom()!==room)return;
      shownRoom=room;last=data;render(data);
    }catch{$('quotaTime').textContent='读取失败，请刷新页面或稍后重试。';if(!last)for(const id of ['quotaMiniCodex','quotaMiniClaude','quotaMiniDeepseek'])$(id).textContent='未获取';}
    finally{working=false;$('quotaRefresh').disabled=false;if(currentRoom()!==room)refresh();}
  }
  $('quotaBtn').onclick=()=>{dialog.showModal();if(last&&shownRoom===currentRoom())render(last);refresh();};
  $('quotaClose').onclick=()=>dialog.close();$('quotaRefresh').onclick=()=>refresh(true);
  dialog.addEventListener('click',async event=>{
    if(!event.target.closest('#quotaReset')||working||resetting)return;
    const room=currentRoom();resetting=true;$('quotaReset').disabled=true;$('quotaRefresh').disabled=true;
    $('quotaActionStatus').textContent='正在使用一张重置卡，请勿重复提交…';
    let pending;try{pending=JSON.parse(sessionStorage.getItem('parley-reset-pending')||'null');}catch{}
    if(!pending?.idempotencyKey){const creditId=last?.codex?.resetCredits?.credits?.[0]?.id;pending={idempotencyKey:crypto.randomUUID(),...(creditId?{creditId}:{})};try{sessionStorage.setItem('parley-reset-pending',JSON.stringify(pending));}catch{}}
    try{
      const response=await fetch('/api/quota/reset',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({room,action:'consume-one',idempotencyKey:pending.idempotencyKey,creditId:pending.creditId})});const data=await response.json();
      if(!response.ok)throw new Error(data.error||'请求未完成，请稍后重试。');
      try{sessionStorage.removeItem('parley-reset-pending');}catch{}
      const messages={reset:'已消耗一张重置卡，额度已重新读取。',alreadyRedeemed:'这次重置此前已经完成，没有重复消耗卡片。',nothingToReset:'当前没有可重置的额度，未消耗重置卡。',noCredit:'当前没有可用重置卡，未执行重置。'};
      $('quotaActionStatus').textContent=messages[data.outcome]||'请刷新额度查看结果。';
      if(currentRoom()===room){last=data;shownRoom=room;render(data);}
    }catch(e){$('quotaActionStatus').textContent=e.message+' 再次点击会沿用同一请求编号，避免重复消耗。';}
    finally{resetting=false;$('quotaRefresh').disabled=false;if(last&&shownRoom===currentRoom())render(last);else refresh();}
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('parley-room-changed',()=>{last=null;for(const id of ['quotaMiniCodex','quotaMiniClaude','quotaMiniDeepseek'])$(id).textContent='读取中…';refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},60000);
  refresh();
})();
