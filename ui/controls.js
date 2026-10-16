(() => {
  'use strict';
  const host=window.parleyControlsHost,bar=document.getElementById('modelBar');
  const headers={'X-Parley-Token':document.querySelector('meta[name="parley-token"]').content,'X-Parley-Runtime-Protocol':document.querySelector('meta[name="parley-runtime-protocol"]').content,'Content-Type':'application/json'};
  let signature='',changing=false;
  const effortNames={none:'不额外思考',minimal:'极简',low:'轻量',medium:'适中',high:'深入',xhigh:'更深入',max:'最大',ultra:'极致',ultracode:'深度编程'};
  function render(){
    const summary=host.getSummary();if(!summary)return;
    const occupied=summary.working||summary.busy?.length||summary.queued||summary.queuedDispatches||Object.values(summary.agents||{}).some(a=>a.held||a.catchUp);
    const next=JSON.stringify([summary.name,summary.cfg,summary.providers,summary.adoptedMemory,!!occupied,changing]);if(signature===next)return;signature=next;bar.replaceChildren();
    for(const seat of summary.seats){
      const cfg=summary.cfg.agents[seat],provider=cfg.provider||seat,catalog=summary.providers[provider];if(!catalog)continue;
      const label=document.createElement('label');label.className='model-choice';
      const name=document.createElement('span');name.textContent=catalog.label;label.append(name);
      const select=document.createElement('select');select.setAttribute('aria-label',catalog.label+' 模型');select.dataset.agent=seat;
      const choices=[{value:'',label:'默认模型'},...(catalog.models||[])];
      if(cfg.model&&!choices.some(c=>c.value===cfg.model))choices.push({value:cfg.model,label:cfg.model});
      for(const choice of choices){const option=document.createElement('option');option.value=choice.value;option.textContent=choice.label||choice.value;select.append(option);}
      select.value=cfg.model||'';select.disabled=!!occupied||changing;select.dataset.field='model';select.title=occupied?'当前有任务，请完成或停止后切换':'切换从下一条消息生效，聊天记录保留';label.append(select);
      const group=document.createElement('div');group.className='model-group';group.append(label);
      if(catalog.fields?.includes('effort')){
        const effortLabel=document.createElement('label');effortLabel.className='effort-choice';
        const effortName=document.createElement('span');effortName.textContent='思考';effortLabel.append(effortName);
        const effortSelect=document.createElement('select');effortSelect.dataset.agent=seat;effortSelect.dataset.field='effort';effortSelect.setAttribute('aria-label',catalog.label+' 思考强度');
        const modelChoice=(catalog.models||[]).find(x=>x.value===cfg.model);
        const supported=modelChoice?.efforts?.length?modelChoice.efforts.map(value=>({value})):(catalog.efforts||[]);
        const levels=[{value:'',label:'默认'},...supported];
        if(cfg.effort&&!levels.some(c=>c.value===cfg.effort))levels.push({value:cfg.effort});
        for(const choice of levels){const option=document.createElement('option');option.value=choice.value;option.textContent=effortNames[choice.value]||choice.label||choice.value;effortSelect.append(option);}
        effortSelect.value=cfg.effort||'';effortSelect.disabled=!!occupied||changing;effortSelect.title='思考强度从下一条消息生效，聊天记录保留';effortLabel.append(effortSelect);group.append(effortLabel);
      }
      bar.append(group);
    }
    const memory=document.createElement('button');memory.type='button';memory.className='memory-shortcut';memory.textContent=summary.adoptedMemory?'项目记录 · v'+summary.adoptedMemory.version:'项目记录';memory.title='整理记录，检查后用于继续交流';memory.onclick=()=>document.getElementById('recorderBtn').click();bar.append(memory);
    const permission=document.createElement('span');permission.className='permission-shortcut';
    const automatic=summary.cfg.mode==='work'&&Object.values(summary.cfg.agents).some(c=>c.autoApprove||c.permissionMode==='smart');
    permission.textContent=automatic?'工作区可编辑':summary.cfg.mode==='work'?'工作模式':'对话模式';permission.title='Codex 使用工作区沙箱；Claude 使用原生自动审批。重要破坏性操作及对外发布需要明确授权。';bar.append(permission);
  }
  bar.addEventListener('change',async event=>{
    const select=event.target.closest('select[data-agent]');if(!select||changing)return;
    const room=host.getRoom(),agent=select.dataset.agent,field=select.dataset.field,value=select.value||null;changing=true;render();
    try{
      const response=await fetch('/api/model',{method:'POST',headers,body:JSON.stringify({room,agent,[field]:value})});const result=await response.json();
      if(!response.ok)throw new Error(result.error||'切换失败');
      if(host.getRoom()===room)host.applySummary(result.room);host.notify((field==='effort'?'思考强度':'模型')+'已切换，下一条消息生效。');
    }catch(e){host.notify(e.message,true);}
    finally{changing=false;signature='';render();}
  });
  window.addEventListener('parley-summary',render);window.addEventListener('parley-room-changed',()=>{signature='';render();});render();
})();
