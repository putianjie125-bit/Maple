(() => {
  'use strict';
  const host = window.parleyControlsHost;
  const el = id => document.getElementById(id);
  const mode = el('conversationMode'), panel = el('consensusPanel'), rounds = el('consensusRounds'), custom = el('consensusCustom');
  const normalPlaceholder = el('input').placeholder;
  const labels = {IDLE:'尚未启动', DISCUSSING:'正在协商', PENDING_CONFIRMATION:'等待双方确认',
    CONSENSUS_REACHED:'双方达成共识', UNRESOLVED:'达到轮数上限，未达成共识', STOPPED:'用户已停止', FAILED:'系统或模型调用失败'};
  let task = null, active = false, pending = false, epoch = 0, timer, selected = '';
  const headers = {'Content-Type':'application/json',
    'X-Parley-Token':document.querySelector('meta[name="parley-token"]').content,
    'X-Parley-Runtime-Protocol':document.querySelector('meta[name="parley-runtime-protocol"]').content};
  async function api(route, body) {
    const response = await fetch(route, {headers, ...(body ? {method:'POST', body:JSON.stringify(body)} : {})});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '共识请求失败');
    return result;
  }
  function render() {
    panel.hidden = mode.value !== 'consensus';
    el('composer').classList.toggle('consensus-selected', !panel.hidden);
    el('input').placeholder = panel.hidden ? normalPlaceholder : '输入双方需要协商的文字任务…';
    el('sendBtn').textContent = panel.hidden ? '发送' : '开始协商';
    custom.hidden = rounds.value !== 'custom';
    rounds.disabled = active; custom.disabled = active;
    el('consensusStop').disabled = !active || pending || !!selected;
    el('consensusStatus').textContent = task ? `${labels[task.state] || task.state} (${task.state}) · ${task.usedRounds || 0}/${task.maxRounds || 3} 轮 · 实际调用 ${task.calls?.length || 0} 次` : '尚未启动 (IDLE)';
    el('consensusQuestion').textContent = task?.question ? '原始任务：' + task.question : '';
    const candidate = task?.candidates?.find(c => c.version === task.currentVersion);
    el('consensusCandidate').textContent = candidate ? `当前候选 v${candidate.version} · 提案方 ${candidate.proposer}\nSHA-256: ${candidate.hash}\n${candidate.content}` : '尚无候选方案。';
    el('consensusVotes').replaceChildren();
    for (const model of ['codex', 'claude']) {
      const vote = candidate?.confirmations?.[model], row = document.createElement('p');
      row.textContent = `${model}: ${vote ? vote.valid ? vote.decision : '确认无效，未计为同意' : '尚未确认'}` +
        (vote ? ` · v${vote.version} · ${vote.confirmedAt}\n${vote.hash}\n${vote.reason || vote.protocolError}` : '');
      el('consensusVotes').append(row);
    }
    el('consensusFinal').textContent = task?.state === 'CONSENSUS_REACHED' && task.finalResult
      ? `最终共同方案 v${task.finalResult.version}\nSHA-256: ${task.finalResult.hash}\n${task.finalResult.content}\n模型共识不等于客观验证。`
      : '尚无经双方共同确认的最终方案。';
    el('consensusDisagreements').textContent = task?.unresolved?.length ? task.unresolved.map(x =>
      `${x.model || '系统'} · 第${x.round}轮${x.version ? ' · v' + x.version : ''}：${x.reason}`).join('\n') : '暂无记录的分歧。';
    el('consensusUsage').textContent = task?.calls?.some(c => c.usage) ? task.calls.filter(c => c.usage).map(c => `${c.model} · 第${c.round}轮 · ${c.phase}: ${JSON.stringify(c.usage)}`).join('\n') : 'CLI 尚未提供可靠的用量字段；不估算总 token。';
    el('consensusError').textContent = task?.error || '';
    el('consensusId').textContent = task?.id || '';
  }
  async function refresh() {
    clearTimeout(timer);
    const room = host.getRoom(), current = ++epoch;
    try {
      const result = await api('/api/consensus?room=' + encodeURIComponent(room) + (selected ? '&id=' + encodeURIComponent(selected) : ''));
      if (current !== epoch || room !== host.getRoom()) return;
      task = result.task; active = result.active;
      const history = el('consensusHistory'); history.replaceChildren(new Option('当前任务', ''));
      for (const t of result.tasks) history.add(new Option(`${t.question.slice(0,35)} · ${labels[t.state]}`, t.id));
      history.value = selected; render();
    } catch (error) { if (current === epoch) el('consensusError').textContent = error.message; }
    finally { if (current === epoch && mode.value === 'consensus') timer = setTimeout(refresh, active ? 1200 : 5000); }
  }
  mode.onchange = () => { render(); if (mode.value === 'consensus') refresh(); else {++epoch; clearTimeout(timer);} };
  rounds.onchange = render;
  el('consensusRefresh').onclick = refresh;
  el('consensusHistory').onchange = event => { selected = event.target.value; refresh(); };
  el('consensusStop').onclick = async () => {
    pending = true; render();
    try { await api('/api/consensus/stop', {room:host.getRoom(), id:task?.id}); await refresh(); }
    catch (error) { host.notify(error.message, true); }
    finally { pending = false; render(); }
  };
  window.mapleConsensus = {
    enabled:() => mode.value === 'consensus',
    async start(question) {
      if (pending || active) throw new Error('协商正在运行或停止中，请先停止。');
      const maxRounds = Number(rounds.value === 'custom' ? custom.value : rounds.value);
      if (!Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > 20) throw new Error('最大轮数必须是 1～20 的整数。');
      const room = host.getRoom(); pending = true;
      try {
        await api('/api/consensus/start', {room, question, maxRounds});
        if (host.getRoom() === room) { selected = ''; await refresh(); }
      } finally { pending = false; render(); }
    },
  };
  window.addEventListener('parley-room-changed', () => {
    ++epoch; clearTimeout(timer); selected = ''; task = null; active = false; mode.value = 'chat'; render();
  });
  render();
})();
