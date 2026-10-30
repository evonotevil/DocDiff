// 修订审阅里按 J 逐处切换的耗时（对比 1.7.5 / 1.8）。用法：APP=<应用目录> xvfb-run -a node scripts/perf-review-nav.cjs <A> <B> [次数]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, N = '30'] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'nav-')) } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click());
  await win.waitForTimeout(1500);
  await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await win.waitForTimeout(500);
  await win.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
  const lat = [];
  for (let i = 0; i < +N; i++) {
    const s = Date.now();
    await win.keyboard.press('j');
    await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    lat.push(Date.now() - s);
  }
  const first = lat[0];
  const sorted = [...lat].sort((a, b) => a - b);
  console.log(JSON.stringify({ first, median: sorted[sorted.length >> 1], p95: sorted[Math.floor(sorted.length * 0.95)], max: sorted[sorted.length - 1], long: await win.evaluate(() => window.__long) }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
