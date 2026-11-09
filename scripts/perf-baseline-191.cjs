// 1.9.1 macOS 实测里已通过的两个场景，作为性能回归基线（1.9.2 起每次发版前跑）。只用合成夹具，日志里称 Document A / B。
//   modes：同一对 3,000 段 Word，在纯文本 → 修订审阅 → 富文本之间切 ROUNDS 轮（默认 20 轮 = 60 次）。
//          计时口径：触发切换到目标视图出现后两帧。首次进入纯文本单独统计；热切换参考值 < 100ms。
//          每 5 轮强制 GC 后记 JS 堆，看是否随轮次持续增长。
//   pdf：  两份各 120 页的 PDF，进入图像模式，已比较约 5 页时点「停止比较」：
//          记停止反馈（按钮消失）、停止后 700ms 和 2s 页数是否还在涨（后台是否真的停了），
//          再点「继续比较」：记完成全部 120 页的耗时，核对没有漏页、没有重复页；全程记超过 50ms 的长任务。
//   两个场景都以 200ms 间隔采样进程工作集，分别报告“合计”和“渲染进程”峰值（合计可能重复计入共享页，只作观察）。
// 用法：
//   python3 scripts/make-perf-review-3000.py && python3 scripts/make-perf-pdf-120.py
//   xvfb-run -a node scripts/perf-baseline-191.cjs [modes|pdf|all] [输出.json]
//   ROUNDS=20 …；用安装包：ELECTRON=<可执行文件> PACKAGED=1 …
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const WHAT = process.argv[2] || 'all', OUT = process.argv[3];
const ROUNDS = +(process.env.ROUNDS || 20);
// 热切换参考值：macOS 实测 < 100ms；Linux 无显卡 xvfb 下渲染慢一截，可以用 SWITCH_MAX=250 跑
const SWITCH_MAX = +(process.env.SWITCH_MAX || 100);
const WORK = path.join(__dirname, '../work');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function launch(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-base-'));
  const names = files.map(([src, nm]) => { const p = path.join(dir, nm); fs.copyFileSync(src, p); return p; });
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', ...(process.env.PACKAGED ? [] : [APP]), ...names], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  // 200ms 采样进程内存
  const mem = { total: 0, renderer: 0 }; let stop = false;
  (async () => {
    while (!stop) {
      try {
        const m = await app.evaluate(({ app }) => { const ms = app.getAppMetrics(); const r = ms.filter((x) => x.type === 'Tab' || x.type === 'Renderer'); return { t: ms.reduce((s, x) => s + x.memory.workingSetSize, 0), r: Math.max(0, ...r.map((x) => x.memory.workingSetSize)) }; });
        mem.total = Math.max(mem.total, Math.round(m.t / 1024)); mem.renderer = Math.max(mem.renderer, Math.round(m.r / 1024));
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
  })();
  await win.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); });
  return { app, win, errs, mem, close: async () => { stop = true; await new Promise((r) => setTimeout(r, 250)); await app.close(); } };
}

// 点导航第 i 项，等目标视图出现再过两帧，返回毫秒（页面内计时）
const switchTo = (win, i, sel) => win.evaluate(({ i, sel }) => new Promise((res) => {
  const t0 = performance.now();
  document.querySelectorAll('.nav-list .nav-item')[i].click();
  const seen = () => { const el = document.querySelector(sel); return el && el.getClientRects().length; };
  const tick = () => { if (seen()) requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - t0))); else requestAnimationFrame(tick); };
  tick();
  setTimeout(() => res(-1), 15000);
}), { i, sel });

async function modes() {
  const fx = path.join(WORK, 'perf-3000');
  const s = await launch([[path.join(fx, 'perf3000-A.docx'), 'Document A.docx'], [path.join(fx, 'perf3000-B.docx'), 'Document B.docx']]);
  const { win } = s;
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 180000 });
  await win.waitForTimeout(800);
  // 第一次进修订审阅会问署名，先进一次点掉（不计时）
  const heap = async () => { await win.evaluate(() => { (window.gc || (() => {}))(); }); await win.waitForTimeout(400); return win.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)); };
  const VIEWS = [['plain', 1, '.code .crow'], ['review', 2, '.redline'], ['rich', 0, '.rich .rich-chunk']];
  const times = { plain: [], review: [], rich: [] }; let firstPlain = null; const heaps = [await heap()];
  for (let r = 0; r < ROUNDS; r++) {
    for (const [k, i, sel] of VIEWS) {
      const ms = Math.round(await switchTo(win, i, sel));
      if (k === 'review' && r === 0) await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的|OK/.test(b.textContent))?.click());
      if (k === 'plain' && firstPlain === null) firstPlain = ms; else times[k].push(ms);
      await win.waitForTimeout(150);
    }
    if ((r + 1) % 5 === 0) heaps.push(await heap());
  }
  const long = await win.evaluate(() => window.__long.map((x) => x[1]));
  await s.close();
  const res = { firstPlain, plain: times.plain, review: times.review, rich: times.rich, heaps, mem: s.mem, longOver200: long.filter((x) => x > 200).length };
  console.log(`modes: first plain ${firstPlain}ms · plain ${q(times.plain, 0)}–${q(times.plain, 1)} (p50 ${q(times.plain, .5)}) · review ${q(times.review, 0)}–${q(times.review, 1)} (p50 ${q(times.review, .5)}) · rich ${q(times.rich, 0)}–${q(times.rich, 1)} (p50 ${q(times.rich, .5)})`);
  console.log(`       heap after GC every 5 rounds: ${heaps.join(' → ')} MiB · peak working set total ${s.mem.total} MiB / renderer ${s.mem.renderer} MiB`);
  const all = [...times.plain, ...times.review, ...times.rich];
  ok(`modes: ${ROUNDS * 3} switches, none stuck`, all.every((x) => x >= 0) && firstPlain >= 0 && all.length === ROUNDS * 3 - 1);
  ok(`modes: warm switches p90 < ${SWITCH_MAX}ms (same-machine reference)`, q(all, .9) < SWITCH_MAX, { p90: q(all, .9), max: q(all, 1) });
  const tail = heaps.slice(1);
  ok('modes: JS heap after GC does not keep growing (last ≤ first-after-warmup + 10%)', tail[tail.length - 1] <= tail[0] * 1.1 + 2, { heaps });
  ok('modes: no page errors', !s.errs.length, s.errs.slice(0, 3));
  return res;
}

async function pdf() {
  const fx = path.join(WORK, 'perf-pdf120');
  const s = await launch([[path.join(fx, 'pdf120-A.pdf'), 'Document A.pdf'], [path.join(fx, 'pdf120-B.pdf'), 'Document B.pdf']]);
  const { win } = s;
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 180000 });
  await win.waitForTimeout(500);
  const tLong = await win.evaluate(() => performance.now());
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click());
  await win.waitForTimeout(400);
  await win.evaluate(() => [...document.querySelectorAll('.range-gate .btn.primary')][0]?.click());
  const pages = () => win.evaluate(() => [...document.querySelectorAll('.imgview .pagepair .ptitle span:first-child')].map((e) => +(/\d+/.exec(e.textContent) || [0])[0]));
  await win.waitForFunction(() => document.querySelectorAll('.imgview .pagepair').length >= 5, null, { timeout: 120000 });
  const atStop = (await pages()).length;
  const stopMs = Math.round(await win.evaluate(() => new Promise((res) => {
    const b = [...document.querySelectorAll('.btn')].find((x) => /停止比较/.test(x.textContent));
    if (!b) return res(-1);
    const t0 = performance.now(); b.click();
    const tick = () => { if (![...document.querySelectorAll('.btn')].some((x) => /停止比较/.test(x.textContent))) res(performance.now() - t0); else requestAnimationFrame(tick); };
    tick(); setTimeout(() => res(-1), 5000);
  })));
  const afterStop = (await pages()).length;
  await win.waitForTimeout(700); const at700 = (await pages()).length;
  await win.waitForTimeout(1300); const at2s = (await pages()).length;
  const phase = await win.evaluate(() => document.querySelector('.range-line')?.dataset.phase);
  const t0 = Date.now();
  await win.evaluate(() => [...document.querySelectorAll('.range-line .link-btn')].find((b) => /继续比较/.test(b.textContent))?.click());
  await win.waitForFunction(() => document.querySelector('.range-line')?.dataset.phase === 'done', null, { timeout: 300000 });
  const resumeMs = Date.now() - t0;
  await win.waitForTimeout(300);
  const final = await pages();
  const long = await win.evaluate((t) => window.__long.filter((x) => x[0] >= t).map((x) => x[1]), tLong);
  await s.close();
  const uniq = new Set(final);
  const res = { atStop, afterStop, stopMs, at700, at2s, phase, resumeMs, pages: final.length, unique: uniq.size, longOver50: long.filter((x) => x > 50), mem: s.mem };
  console.log(`pdf: stop at ${atStop} pages · stop feedback ${stopMs}ms · pages ${afterStop} → +700ms ${at700} → +2s ${at2s} · resume → all done in ${(resumeMs / 1000).toFixed(1)}s · ${final.length} pages (${uniq.size} unique)`);
  console.log(`     long tasks > 50ms: ${res.longOver50.length ? res.longOver50.join(' ') : 'none'} · peak working set total ${s.mem.total} MiB / renderer ${s.mem.renderer} MiB`);
  ok('pdf: stop feedback in the 100ms range (< 300ms)', stopMs >= 0 && stopMs < 300, { stopMs });
  ok('pdf: page count stops growing after stop (700ms and 2s)', at700 === afterStop && at2s === afterStop && phase === 'stopped', { afterStop, at700, at2s, phase });
  ok('pdf: resume finishes all 120 pages, none missing or duplicated', final.length === 120 && uniq.size === 120 && Math.min(...final) === 1 && Math.max(...final) === 120, { pages: final.length, unique: uniq.size });
  ok('pdf: no page errors', !s.errs.length, s.errs.slice(0, 3));
  return res;
}

(async () => {
  const out = {};
  if (WHAT === 'modes' || WHAT === 'all') out.modes = await modes();
  if (WHAT === 'pdf' || WHAT === 'all') out.pdf = await pdf();
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
