// PDF 双文档比较卡顿修复的验收测试（合成夹具，文档一律称 Document A / B）。
// 用法：xvfb-run -a node scripts/e2e-pdf-perf.cjs <A.pdf> <B.pdf> [输出目录]
// 1. 首页放入两份文件、点“开始比较”：2 秒内出现结果或带“取消比较”的进度界面；比较期间主线程每次探测都在 200 ms 内响应
// 2. 进度界面里点“取消比较”：出现“已取消比较”；再点“重新比较”能得到结果
// 3. 结果出来后：J / K、筛选的视觉反馈（输入到下一帧）在 100 ms 内；滚动 ≥ 30 FPS；没有超过 200 ms 的长任务
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'pdfperf-'))] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
let fails = 0; const log = [];
const ok = (c, m) => { const l = `${c ? 'PASS' : 'FAIL'}  ${m}`; console.log(l); log.push(l); if (!c) fails++; };

async function home() {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'pp-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForSelector('.home-cta', { timeout: 60000 });
  for (const [i, f] of [A, B].entries()) {
    await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.send('open-path', f), f);
    await win.waitForFunction((n) => document.querySelectorAll('.drop.filled').length >= n, i + 1, { timeout: 120000 });
  }
  await win.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' });
  });
  return { app, win };
}
const state = (win) => win.evaluate(() => ({
  result: !!document.querySelector('.tb-pos') && !document.querySelector('.main .spinner'),
  progress: !!document.querySelector('.main .progress') || /正在比较/.test(document.querySelector('.main')?.innerText || ''),
  cancel: [...document.querySelectorAll('.main button')].some((b) => b.textContent === '取消比较'),
  cancelled: /已取消比较/.test(document.querySelector('.main')?.innerText || ''),
}));
async function probe(win) { const s = Date.now(); const r = await Promise.race([state(win), new Promise((res) => setTimeout(() => res(null), 2000))]); return { ms: Date.now() - s, r }; }

(async () => {
  // 1 + 3
  let { app, win } = await home();
  const t0 = Date.now();
  await win.click('.home-cta button:not([disabled])');
  let first = null, maxProbe = 0, sawProgress = false, done = false;
  for (let i = 0; i < 600 && !done; i++) {
    const p = await probe(win); maxProbe = Math.max(maxProbe, p.ms);
    if (p.r && (p.r.result || p.r.progress) && first === null) first = Date.now() - t0;
    if (p.r?.progress && p.r.cancel) sawProgress = true;
    if (p.r?.result) done = true; else await win.waitForTimeout(50);
  }
  const total = Date.now() - t0;
  ok(first !== null && first <= 2000, `点“开始比较”后 ${first} ms 出现${sawProgress ? '带“取消比较”的进度界面' : '结果'}（结果在 ${total} ms 出来）`);
  ok(maxProbe <= 400, `比较期间主线程探测最大延迟 ${maxProbe} ms（含自动化往返）`);
  await win.waitForTimeout(1500);
  const frameAfter = async (fn) => win.evaluate(async (src) => {
    const t = performance.now(); (0, eval)(src); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); return Math.round(performance.now() - t);
  }, fn);
  const press = (k) => `document.dispatchEvent(new KeyboardEvent('keydown',{key:'${k}',bubbles:true}))`;
  const J = [], K = [], FL = [];
  for (let i = 0; i < 8; i++) J.push(await frameAfter(press('j')));
  for (let i = 0; i < 4; i++) K.push(await frameAfter(press('k')));
  for (const re of ['新增', '全部', '修改', '全部']) FL.push(await frameAfter(`[...document.querySelectorAll('.chips .fchip')].find((b) => /${re}/.test(b.textContent))?.click()`));
  const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
  const sel = await win.evaluate(() => document.querySelector('.dlist .drow.sel')?.getAttribute('data-chg'));
  ok(!!sel, `J / K 改变了选中的差异（#${sel}）`);
  ok(med(J) <= 100 && med(K) <= 100, `J 输入到下一帧 中位 ${med(J)} ms（最大 ${Math.max(...J)}），K 中位 ${med(K)} ms（最大 ${Math.max(...K)}）`);
  ok(med(FL) <= 100, `筛选输入到下一帧 中位 ${med(FL)} ms（${FL.join(' / ')}）`);
  const scroll = await win.evaluate(async () => {
    const el = document.querySelector('.main .scroll'); const g = []; let last = performance.now();
    await new Promise((res) => { const end = performance.now() + 3000; const f = (t) => { g.push(t - last); last = t; el.scrollTop += 40; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    return { fps: +(g.length / 3).toFixed(1), max: Math.round(Math.max(...g.slice(1))) };
  });
  ok(scroll.fps >= 30, `滚动 ${scroll.fps} FPS（最大帧间隔 ${scroll.max} ms）`);
  const longs = await win.evaluate(() => window.__long);
  ok(Math.max(0, ...longs) <= 200, `从点“开始比较”到现在没有超过 200 ms 的长任务（共 ${longs.length} 个长任务，最长 ${Math.max(0, ...longs)} ms）`);
  await win.screenshot({ path: path.join(OUT, 'result.png') });
  await app.close();

  // 2. 取消
  ({ app, win } = await home());
  await win.click('.home-cta button:not([disabled])');
  let canClick = false;
  for (let i = 0; i < 100 && !canClick; i++) { const s = await state(win); if (s.cancel) canClick = true; else if (s.result) break; else await win.waitForTimeout(20); }
  if (canClick) {
    await win.screenshot({ path: path.join(OUT, 'progress.png') });
    await win.evaluate(() => [...document.querySelectorAll('.main button')].find((b) => b.textContent === '取消比较').click());
    await win.waitForTimeout(500);
    const s = await state(win);
    ok(s.cancelled && !s.result, '比较中点“取消比较”：显示“已取消比较”，没有结果');
    await win.evaluate(() => [...document.querySelectorAll('.main button')].find((b) => /重新比较|再比较|重试/.test(b.textContent))?.click());
    await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !document.querySelector('.main .spinner'), null, { timeout: 60000 });
    ok(true, '取消后点“重新比较”得到结果');
  } else ok(false, '没赶上点取消：比较在进度界面出现前就完成了');
  await app.close();
  fs.writeFileSync(path.join(OUT, 'results.txt'), log.join('\n') + '\n');
  console.log(fails ? `${fails} 项失败` : '全部通过');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
