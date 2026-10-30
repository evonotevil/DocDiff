// 审阅稿被 Word 占着时的滚动（beta.7 复查）：Word 打开审阅稿后，每 3 秒检查一次；看滚动时有没有掉帧。
// 用法：APP=<应用目录> xvfb-run -a node scripts/perf-scroll-locked.cjs <A> <B>
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lk-'));
const [SA, SB] = process.argv.slice(2);
const A = path.join(dir, 'A.docx'), B = path.join(dir, 'B.docx'); fs.copyFileSync(SA, A); fs.copyFileSync(SB, B);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'lkc-')) } });
  const w = await app.firstWindow();
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(1000);
  await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('a'); await w.waitForTimeout(300);
  await w.evaluate(() => document.querySelector('.tb-start')?.click()); await w.waitForTimeout(2500);
  await w.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  const d = fs.readdirSync(dir).find((f) => /我方意见/.test(f));
  fs.writeFileSync(path.join(dir, '~$' + d.slice(2)), 'lock');
  await w.keyboard.press('a'); await w.waitForTimeout(1500);
  const chip = await w.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label'));
  await w.mouse.move(500, 450);
  await w.evaluate(() => { window.__r = 0; window.__f = []; window.__l = []; let last = performance.now(); window.__on = true; const tick = (t) => { window.__f.push(t - last); last = t; if (window.__on) requestAnimationFrame(tick); }; requestAnimationFrame(tick); new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__l.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); });
  for (let j = 0; j < 160; j++) { await w.mouse.wheel(0, j % 40 < 20 ? 90 : -90); await w.waitForTimeout(50); }
  const r = await w.evaluate(() => { window.__on = false; const f = window.__f.slice(2).sort((a, b) => a - b); return { frames: f.length, p95: +f[Math.floor(f.length * 0.95)].toFixed(1), over33: f.filter((x) => x > 33).length, over50: f.filter((x) => x > 50).length, max: Math.round(f[f.length - 1]), long: window.__l }; });
  console.log(JSON.stringify({ chip, ...r }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
