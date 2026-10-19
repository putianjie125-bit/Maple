import {test, expect} from './browser-fixture.mjs';
import {fileURLToPath} from 'node:url';
const command=fileURLToPath(new URL('./fake-consensus-cli.mjs',import.meta.url));
async function configure(server) {
  const result=await server.api('POST','/api/config',{room:'default',config:{agents:{codex:{command},claude:{command}}}});
  expect(result.status).toBe(200);
}
test('consensus is off by default; same composer starts a task and shows bilateral confirmation',async({app,server},testInfo)=>{
  await configure(server);
  await expect(app.locator('#conversationMode')).toHaveValue('chat');await expect(app.locator('#consensusPanel')).toBeHidden();
  await app.locator('#conversationMode').selectOption('consensus');await expect(app.locator('#consensusRounds')).toHaveValue('3');
  await expect(app.locator('#sendBtn')).toHaveText('开始协商');
  await app.locator('#consensusRounds').selectOption('custom');await app.locator('#consensusCustom').fill('2');
  await app.locator('#input').fill('浏览器共同方案测试');await app.locator('#sendBtn').click();
  await expect(app.locator('#consensusStatus')).toContainText('CONSENSUS_REACHED');
  await expect(app.locator('#consensusStatus')).toContainText('1/2 轮');
  await app.locator('#consensusPanel summary').filter({hasText:'双方确认情况'}).click();
  await expect(app.locator('#consensusVotes')).toContainText('codex: AGREE');await expect(app.locator('#consensusVotes')).toContainText('claude: AGREE');
  await expect(app.locator('#consensusFinal')).toContainText('模拟共同方案');
  await expect(app.locator('#consensusFinal')).toContainText('不等于客观验证');
  await expect(app.locator('#consensusStop')).toBeDisabled();
  await app.locator('#consensusPanel summary').filter({hasText:'双方确认情况'}).click();
  await app.screenshot({path:testInfo.outputPath('consensus.png'),fullPage:true});
  await app.setViewportSize({width:390,height:844});
  if(await app.locator('#navScrim').isVisible())await app.locator('#navScrim').click({position:{x:300,y:20}});
  expect(await app.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await app.screenshot({path:testInfo.outputPath('consensus-mobile.png'),fullPage:true});
  await app.setViewportSize({width:1440,height:1000});
  await app.reload();await expect(app.locator('#connDot')).toHaveClass(/on/);
  await expect(app.locator('#conversationMode')).toHaveValue('chat');
  await app.locator('#conversationMode').selectOption('consensus');
  await expect(app.locator('#consensusStatus')).toContainText('CONSENSUS_REACHED');
  await expect(app.locator('#consensusFinal')).toContainText('模拟共同方案');
  await app.locator('#conversationMode').selectOption('chat');await expect(app.locator('#sendBtn')).toHaveText('发送');
});
test('UI enforces custom bounds, stops a task and never renders final agreement',async({app,server})=>{
  await configure(server);await app.locator('#conversationMode').selectOption('consensus');
  await app.locator('#consensusRounds').selectOption('custom');await app.locator('#consensusCustom').fill('21');
  await app.locator('#input').fill('SLOW 浏览器停止');await app.locator('#input').press('Enter');
  await expect(app.locator('#input')).toHaveValue('SLOW 浏览器停止');
  expect((await server.api('GET','/api/consensus')).data.task.state).toBe('IDLE');
  await app.locator('#consensusCustom').fill('1');await app.locator('#sendBtn').click();
  await expect(app.locator('#consensusStatus')).toContainText('DISCUSSING');
  await expect(app.locator('#consensusStop')).toBeEnabled();await app.locator('#consensusStop').click();
  await expect(app.locator('#consensusStatus')).toContainText('STOPPED');
  await expect(app.locator('#consensusFinal')).toHaveText('尚无经双方共同确认的最终方案。');
});
