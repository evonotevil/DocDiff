// 模式切换的内存（beta.7 · 性能 7）：富文本 / 纯文本 / 修订审阅来回切 N 轮，每 10 轮强制 GC 后记一次 JS 堆。
// 只看能否回落，不据此下“泄漏”结论。用法：xvfb-run -a node scripts/soak-mode-switch.cjs <A> <B> [轮数]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, N = '60'] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--js-flags=--expose-gc', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'soak-')) } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  const heap = async () => { await win.evaluate(() => { (window.gc || (() => {}))(); }); await win.waitForTimeout(300); return win.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)); };
  const nav = (i) => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i]?.click(), i);
  const samples = [await heap()]; let peak = 0;
  for (let i = 1; i <= +N; i++) {
    for (const k of [1, 0, 2, 1, 0]) { await nav(k); await win.waitForTimeout(120); peak = Math.max(peak, await win.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576))); }
    if (i % 10 === 0) samples.push(await heap());
  }
  console.log(JSON.stringify({ rounds: +N, heapAfterGcMB: samples, peakMB: peak }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
