import automator from 'miniprogram-automator';
const connect = automator.connect.bind(automator);
const mini = await connect({ wsEndpoint: 'ws://127.0.0.1:9420' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
await mini.reLaunch('/pages/index/index');
await sleep(4500);
for (const theme of ['sakura', 'github-light', 'github-dark', 'honey']) {
  await mini.evaluate(t => new Promise(res => { wx.setStorage({ key: 'app_theme', data: t, complete: res }); }), theme);
  await mini.reLaunch('/pages/index/index');
  await sleep(4500);
  await mini.screenshot({ path: `/Users/wx/WorkBuddy/what-to-eat-discovery/preview/after-${theme}.png` });
  console.log('shot', theme);
}
await mini.disconnect();
