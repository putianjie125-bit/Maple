import fs from 'node:fs';
import path from 'node:path';

// Reuse Maple's adapters, run ownership and process-tree cancellation without
// re-entering causal/automatic delivery. Native chat sessions are never reused
// or overwritten: each invocation receives an isolated state and readonly scope.
export function consensusTransport(room, {adapters, beginRun, releaseSeat, stopRun}) {
  return async ({id, taskId, round, model, phase, prompt, signal}) => {
    const seat = room.consensusSeats[model];
    if (signal.aborted) throw new Error('Consensus stopped');
    const run = beginRun(room, seat, {phase:'consensus-' + phase, startedAt:Date.now(),
      delivery:{kind:'consensus', taskId, round, model, phase, counted:false}});
    const stop = () => stopRun(room, run);
    signal.addEventListener('abort', stop, {once:true});
    // A new empty directory prevents accidental discovery of peer responses in
    // the shared chat workspace. User task data is carried only by the prompt.
    const workspace = path.join(room.dir, 'consensus', 'work', taskId, String(round), phase, model, id);
    const isolated = {...room, workspace, cfg:structuredClone(room.cfg), state:structuredClone(room.state)};
    isolated.cfg.mode = 'talk'; isolated.cfg.projectDir = null;
    for (const cfg of Object.values(isolated.cfg.agents)) {
      cfg.extraArgs = []; cfg.sandbox = 'read-only'; cfg.permissionMode = 'plan'; cfg.autoApprove = false;
    }
    isolated.stateFile = path.join(workspace, 'state.json');
    isolated.state.agents[seat].sessionRef = null;
    try {
      fs.mkdirSync(workspace, {recursive:true});
      if (signal.aborted) { stop(); throw new Error('Consensus stopped'); }
      return await adapters[model](isolated, {seat, prompt, discussion:true, readOnly:true,
        briefing:`你是 ${model}。本次是独立的共识调用，任务 ${taskId}，第 ${round} 轮，阶段 ${phase}。仅参与方案讨论，禁止工具操作、访问文件或外部通信。不得代表其他模型。`});
    } finally {
      signal.removeEventListener('abort', stop);
      releaseSeat(room, seat, run);
    }
  };
}
