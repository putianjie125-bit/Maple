/* DeepSeek Flash recorder: secrets are sent only to the authenticated local
   settings endpoint; neither storage APIs nor chat messages receive the key. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const token=document.querySelector('meta[name="parley-token"]').content;
  const protocol=document.querySelector('meta[name="parley-runtime-protocol"]').content;
  const headers={'X-Parley-Token':token,'X-Parley-Runtime-Protocol':protocol};
  const activeRoom=()=>window.parleyRecorderHost.getRoom();
  let shownRoom=null,working=false,timer=null,last=null,configureOnOpen=false;
  const dialog=document.createElement('dialog');dialog.id='recorderDialog';
  dialog.setAttribute('aria-labelledby','recorderTitle');
  dialog.innerHTML=`
    <div class="rec-head"><div><h2 id="recorderTitle">📝 项目记录</h2><p>自动保留原文，按需整理，检查后继续交流。</p></div><button type="button" id="recClose" aria-label="关闭项目记录">✕</button></div>
    <details class="rec-card rec-config" id="recConfig"><summary>记录员设置 <span id="recConfigState"></span></summary><div class="rec-config-body">
      <label>DeepSeek 官方 API Key<input id="recKey" type="password" autocomplete="new-password" spellcheck="false" placeholder="填写后保存在本机，不会显示出来"></label>
      <label>记录保存位置<input id="recPath" type="text" spellcheck="false" placeholder="自动选择本地文件夹"></label>
      <p class="rec-note">使用 DeepSeek Flash。填写 Key 后才能整理；不填写也可以正常聊天。</p>
      <p class="rec-note">按聊天室保存项目记忆、原始对话和历史摘要。密钥使用当前 Windows 账户加密，单独保存在聊天室数据的配置中，不写入 Markdown 记录。更换文件夹时会复制已有记录，旧文件保留。</p>
      <div class="rec-actions"><button type="button" id="recSave">保存设置</button><button type="button" id="recTest">测试连接</button><button type="button" id="recRemove" class="rec-muted">移除已保存密钥</button><span id="recKeyState">正在读取设置…</span></div>
    </div></details>
    <section class="rec-card"><h3 id="recRoomTitle">当前聊天室</h3><p id="recStatus" role="status"></p>
      <div class="rec-actions"><button type="button" id="recSummarize" class="rec-primary" title="使用 DeepSeek API 整理，会产生 API 费用">整理记录</button><button type="button" id="recContinue">用这份记录继续</button></div>
      <p class="rec-note">整理使用 DeepSeek API。请先检查内容，再用于双方下次回复；原始聊天会保留。</p>
      <div id="recMessage" role="status" aria-live="polite"></div>
      <div id="recMemory" class="rec-memory">聊天后点击“整理记录”，这里会显示整理稿。</div>
      <details class="rec-extra"><summary>修订说明（可选）</summary><label class="rec-review-label">需要纠正或补充的内容<textarea id="recReview" maxlength="4000" rows="3" placeholder="如果整理稿有误，在这里说明，再点击“用这份记录继续”。"></textarea></label></details>
      <details class="rec-extra"><summary>导出与文件夹</summary><div class="rec-actions"><button type="button" id="recExport">导出整理稿</button><button type="button" id="recOpen">打开保存位置</button></div><p class="rec-note">整理只发送文字与必要旧证据，不发送附件正文。DeepSeek 没有工具或执行权限。</p></details>
      <details id="recSourceWrap" hidden><summary>查看原文</summary><pre id="recSource"></pre></details>
    </section>`;
  document.body.append(dialog);
  async function api(route,body){
    const response=await fetch('/api/recorder/'+route,body===undefined?{headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||'记录员请求失败，请刷新页面后重试。');
    return data;
  }
  function message(text,error=false){$('recMessage').textContent=text;$('recMessage').className=error?'rec-error':'rec-success';}
  function controls(){
    for(const id of ['recSave','recTest','recRemove','recSummarize','recContinue','recExport','recOpen'])$(id).disabled=working||!!last?.busy;
    if(!working&&!last?.busy){
      $('recTest').disabled=!last?.hasKey;
      $('recRemove').disabled=!last?.hasKey;
      $('recSummarize').disabled=!last?.hasKey||last?.pending===0;
      $('recContinue').disabled=!last?.canContinue;
      $('recExport').disabled=!last?.memory;
    }
  }
  function renderMemory(text){
    const box=$('recMemory');box.replaceChildren();
    const parts=String(text||'聊天后点击“整理记录”，这里会显示整理稿。').split(/(#\d+)/g);
    for(const part of parts){
      if(/^#\d+$/.test(part)){
        const button=document.createElement('button');button.type='button';button.className='rec-source-ref';button.dataset.source=part.slice(1);button.textContent=part;button.title='查看这条原始消息';box.append(button);
      }else box.append(document.createTextNode(part));
    }
  }
  function render(data){
    const previousHasKey=last?.hasKey;
    last=data;
    if(configureOnOpen||!previousHasKey&&data.hasKey){$('recConfig').open=!data.hasKey;configureOnOpen=false;}
    $('recConfigState').textContent=data.hasKey?'已配置':'选填';
    $('recPath').value=data.recordDir;
    $('recKeyState').textContent=data.hasKey?'✓ 密钥已加密保存':'尚未填写 API Key';
    $('recRoomTitle').textContent='当前聊天室：'+shownRoom;
    $('recStatus').textContent=data.busy?'正在整理，请稍候…':data.memory
      ?`整理稿 v${data.memory.version} · ${data.pending} 条新对话待整理${data.compacted?' · 正在使用 v'+data.compacted.version:' · 尚未用于继续交流'}`
      :`已保存 ${data.totalMessages} 条文字对话，尚未整理。`;
    if(data.error)message(data.error,true);
    renderMemory(data.markdown);
    $('recReview').disabled=!data.memory;
    controls();
  }
  async function refresh(){
    const name=shownRoom;
    const data=await api('status?room='+encodeURIComponent(name));
    if(shownRoom===name)render(data);
  }
  async function run(action,done){
    if(working)return;working=true;controls();message('正在处理…');
    try{const result=await action();if(done)done(result);await refresh();}
    catch(e){message(e.message,true);}
    finally{working=false;controls();}
  }
  function close(){dialog.close();clearInterval(timer);timer=null;$('recKey').value='';}
  $('recClose').onclick=close;
  dialog.addEventListener('close',()=>{clearInterval(timer);timer=null;$('recKey').value='';});
  $('recorderBtn').onclick=async()=>{
    shownRoom=activeRoom();last=null;configureOnOpen=true;message('');$('recSourceWrap').hidden=true;$('recReview').value='';dialog.showModal();
    try{await refresh();}catch(e){message(e.message,true);}
    timer=setInterval(()=>{if(dialog.open&&!working&&last?.busy)refresh().catch(e=>message(e.message,true));},2500);
  };
  $('recSave').onclick=()=>run(async()=>{
    const body={recordDir:$('recPath').value.trim()};
    if($('recKey').value.trim())body.apiKey=$('recKey').value.trim();
    const result=await api('settings',body);$('recKey').value='';return result;
  },()=>message('设置已保存。可以点击“测试连接”，不会发送聊天内容。'));
  $('recTest').onclick=()=>run(()=>api('test',{}),result=>message(result.message));
  $('recRemove').onclick=()=>run(()=>api('settings',{removeKey:true}),()=>message('已移除本机保存的密钥，记录文件和对话保留。'));
  $('recSummarize').onclick=()=>run(()=>api('summarize',{room:shownRoom}),result=>message(result.pending
    ?`本批整理成功，还有 ${result.pending} 条待处理。可再次点击“整理记录”。`
    :'整理稿已生成，请检查内容；确认后点击“用这份记录继续”。'));
  $('recContinue').onclick=()=>run(()=>api('adopt',{room:shownRoom,version:last?.memory?.version,reviewNote:$('recReview').value}),result=>{message(result.message);window.dispatchEvent(new Event('parley-memory-adopted'));});
  $('recOpen').onclick=()=>run(()=>api('open',{room:shownRoom}),()=>message('记录文件夹已在文件资源管理器中打开。'));
  $('recExport').onclick=()=>run(async()=>{
    const response=await fetch('/api/recorder/export?room='+encodeURIComponent(shownRoom),{headers});
    if(!response.ok){const e=await response.json();throw new Error(e.error||'导出失败。');}
    const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='Parley-'+shownRoom+'-项目记忆.md';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  },()=>message('已导出当前聊天室的项目记忆。'));
  $('recMemory').onclick=async event=>{
    const ref=event.target.closest('[data-source]');if(!ref)return;
    try{
      const result=await api('source?room='+encodeURIComponent(shownRoom)+'&n='+encodeURIComponent(ref.dataset.source));
      $('recSource').textContent=`#${result.n} · ${result.author} · ${result.ts}\n\n${result.text}`;
      $('recSourceWrap').hidden=false;$('recSourceWrap').open=true;
    }catch(e){message(e.message,true);}
  };
})();
