// 滚动流畅度（beta.7 复查）：在富文本 / 纯文本 / 修订审阅里用滚轮连续往下滚，记录帧间隔和长任务。
// 用法：APP=<应用目录> xvfb-run -a node scripts/perf-scroll.cjs <A> <B> [每个模式滚动次数]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, N = '120'] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'scr-')) } });
  const w = await app.firstWindow();
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  const out = {};
  for (const [k, i] of [['rich', 0], ['plain', 1], ['review', 2]]) {
    await w.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
    await w.waitForTimeout(1200);
    await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
    await w.evaluate(() => { document.querySelector('.main .scroll').scrollTop = 0; });
    await w.mouse.move(500, 450);
    await w.waitForTimeout(500);
    await w.evaluate(() => { window.__f = []; window.__l = []; let last = performance.now(); window.__on = true; const tick = (t) => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__l.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
    for (let j = 0; j < +N; j++) { await w.mouse.wheel(0, 120); await w.waitForTimeout(16); }
    await w.waitForTimeout(400);
    const r = await w.evaluate(() => { window.__on = false; const f = window.__f.slice(2).sort((a, b) => a - b); return { frames: f.length, p50: +f[f.length >> 1].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), over33: f.filter((x) => x > 33).length, max: Math.round(f[f.length - 1]), long: window.__l.length, longMax: window.__l.length ? Math.max(...window.__l) : 0, top: document.querySelector('.main .scroll').scrollTop }; });
    out[k] = r;
  }
  console.log(JSON.stringify(out));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
