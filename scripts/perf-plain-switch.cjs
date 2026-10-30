// 纯文本视图切换耗时（beta.7 · 性能 6）：富文本 ↔ 纯文本来回切，记切到纯文本后两帧的时间、长任务和 DOM 节点数。
// 用法：APP=<应用目录> xvfb-run -a node scripts/perf-plain-switch.cjs <A> <B> [次数]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, N = '12'] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'plain-')) } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  const nav = (i) => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
  const frames = () => win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  // 预热一次
  await nav(1); await win.waitForSelector('.code .crow'); await frames(); await nav(0); await win.waitForTimeout(800);
  await win.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
  const lat = []; let nodes = 0;
  for (let i = 0; i < +N; i++) {
    const s = await win.evaluate(() => performance.now());
    await nav(1);
    await win.waitForSelector('.code .crow');
    const e = await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now())))));
    lat.push(Math.round(e - s));
    nodes = await win.evaluate(() => document.querySelectorAll('.main *').length);
    // 滚到中间再滚到底，检查按需挂载跟得上
    await win.evaluate(() => { const sc = document.querySelector('.main .scroll'); sc.scrollTop = sc.scrollHeight / 2; });
    await frames();
    await win.evaluate(() => { const sc = document.querySelector('.main .scroll'); sc.scrollTop = sc.scrollHeight; });
    await frames(); await win.waitForTimeout(150);
    await nav(0); await win.waitForTimeout(600);
  }
  const lastRow = await (async () => { await nav(1); await win.waitForSelector('.code .crow'); await frames(); await win.evaluate(() => { const sc = document.querySelector('.main .scroll'); sc.scrollTop = sc.scrollHeight; }); await frames(); await win.waitForTimeout(300); await frames(); return win.evaluate(() => { const rs = [...document.querySelectorAll('.code .crow .ln')].map((x) => +x.textContent).filter(Boolean); return Math.max(...rs); }); })();
  const sorted = [...lat].sort((a, b) => a - b);
  const long = await win.evaluate(() => window.__long);
  console.log(JSON.stringify({ n: lat.length, median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1], longMax: long.length ? Math.max(...long) : 0, longCount: long.length, mainNodes: nodes, lastLineSeen: lastRow, lat }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
