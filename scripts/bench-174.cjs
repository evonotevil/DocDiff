// 1.7.4 性能基准：差异地图 / 正文渲染 / 模式切换。
// 用法：APP=<应用目录> RUNS=3 xvfb-run -a node scripts/bench-174.cjs <A> <B> <标签> <输出目录> [--count-queries]
// 每轮：命令行打开两份文件 → 富文本结果出现（load）→ 结果刚出来时的 3 秒（right-after）→ 纯文本 → 修订审阅 → 回到富文本（switch-back）
//      → 等稳定后：下一处 ×5、点差异地图中部、滚动 4 秒。
// 时间口径：elapsed = 点击到目标视图出现 + 两帧；settle = 点击到最后一个长任务结束（窗口 3 秒）；longest = 窗口内最长任务；
//          p95Gap / maxGap = 窗口内 rAF 帧间隔。--count-queries 时额外统计 querySelector(All) 的次数与累计耗时（包装本身有开销，时间另用不计数的轮次）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const RUNS = +(process.env.RUNS || 3);
const [A, B, LABEL, OUT] = process.argv.slice(2);
const COUNT = process.argv.includes('--count-queries');
const W = 1440, H = 900;
fs.mkdirSync(OUT, { recursive: true });

const INSTR = `(() => {
  window.__q = { n: 0, ms: 0, byPhase: {} , phase: 'load' };
  for (const P of [Element.prototype, Document.prototype]) for (const name of ['querySelector', 'querySelectorAll']) {
    const orig = P[name];
    P[name] = function (s) { const t = performance.now(); try { return orig.call(this, s); } finally { const d = performance.now() - t; const q = window.__q; q.n++; q.ms += d; const b = q.byPhase[q.phase] || (q.byPhase[q.phase] = { n: 0, ms: 0 }); b.n++; b.ms += d; } };
  }
})();`;

// 在页面里开一个观察窗口：长任务 + 帧间隔
const OPEN = () => {
  const w = { t0: performance.now(), long: [], gaps: [], last: performance.now(), run: true };
  try { w.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.long.push({ start: e.startTime, dur: e.duration }); }); w.po.observe({ entryTypes: ['longtask'] }); } catch {}
  const f = (t) => { if (!w.run) return; w.gaps.push(t - w.last); w.last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
  window.__w = w;
  if (window.__q) window.__q.mark = { n: window.__q.n, ms: window.__q.ms };
};
const CLOSE = () => {
  const w = window.__w; w.run = false; try { w.po.disconnect(); } catch {}
  const g = w.gaps.slice(1).sort((a, b) => a - b);
  const long = w.long.filter((x) => x.start + x.dur >= w.t0);
  const q = window.__q ? { queries: window.__q.n - window.__q.mark.n, queryMs: +(window.__q.ms - window.__q.mark.ms).toFixed(1) } : {};
  return {
    longTasks: long.length,
    longestMs: Math.round(Math.max(0, ...long.map((x) => x.dur))),
    settleMs: Math.round(Math.max(0, ...long.map((x) => x.start + x.dur - w.t0))),
    p95GapMs: +(g[Math.floor(g.length * 0.95)] || 0).toFixed(1),
    maxGapMs: +(Math.max(0, ...g)).toFixed(1),
    frames: g.length,
    domNodes: document.getElementsByTagName('*').length,
    heapMB: +((performance.memory?.usedJSHeapSize || 0) / 1048576).toFixed(1),
    ...q,
  };
};
const READY = () => !!document.querySelector('.main .scroll') && !document.querySelector('.main .spinner');

async function rss(app) {
  return app.evaluate(({ app }) => {
    const m = app.getAppMetrics();
    const r = m.find((x) => x.type === 'Tab' || x.type === 'Renderer');
    return { rendererMB: Math.round((r?.memory.workingSetSize || 0) / 1024), totalMB: Math.round(m.reduce((s, x) => s + x.memory.workingSetSize, 0) / 1024) };
  });
}

async function phase(win, name, action, ready = READY, windowMs = 3000) {
  await win.evaluate(OPEN);
  if (COUNT) await win.evaluate((n) => { window.__q.phase = n; }, name);
  const t = Date.now();
  await action();
  await win.waitForFunction(ready, null, { timeout: 180000, polling: 16 });
  await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const elapsedMs = Date.now() - t;
  const rest = windowMs - elapsedMs;
  if (rest > 0) await win.waitForTimeout(rest);
  return { name, elapsedMs, ...(await win.evaluate(CLOSE)) };
}

async function once(run) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-'));
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  await win.setViewportSize({ width: W, height: H });
  if (COUNT) await win.evaluate(INSTR);
  await win.evaluate(OPEN);
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !!document.querySelector('.main .scroll') && !document.querySelector('.main .spinner'), null, { timeout: 180000, polling: 16 });
  const loadMs = Date.now() - t0;
  // 结果刚出来的 3 秒：地图测量、后续渲染都在这里
  await win.waitForTimeout(3000);
  const right = { name: 'right-after-result', elapsedMs: loadMs, ...(await win.evaluate(CLOSE)) };
  const pos = await win.evaluate(() => document.querySelector('.tb-pos')?.textContent?.trim());
  const phases = [right];
  const nav = (i) => () => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
  phases.push(await phase(win, 'plain', nav(1)));
  phases.push(await phase(win, 'review', nav(2)));
  phases.push(await phase(win, 'switch-back-rich', nav(0)));
  const memAfterSwitch = await rss(app);
  // 稳定后的交互
  await win.waitForTimeout(1500);
  phases.push(await phase(win, 'next-x5', async () => { for (let i = 0; i < 5; i++) { await win.evaluate(() => document.querySelector('button[aria-label="下一处"]').click()); await win.waitForTimeout(120); } }, READY, 2500));
  phases.push(await phase(win, 'map-click-mid', async () => {
    const box = await win.evaluate(() => { const r = document.querySelector('.changemap')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height * 0.55 } : null; });
    if (box) await win.mouse.click(box.x, box.y);
  }, READY, 2000));
  const scroll = await win.evaluate(async () => {
    const el = document.querySelector('.main .scroll');
    const gaps = []; let last = performance.now();
    await new Promise((res) => { const end = performance.now() + 4000; const f = (t) => { gaps.push(t - last); last = t; el.scrollTop += 45; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    gaps.sort((a, b) => a - b);
    return { p95GapMs: +gaps[Math.floor(gaps.length * 0.95)].toFixed(1), maxGapMs: +Math.max(...gaps).toFixed(1), frames: gaps.length };
  });
  const map = await win.evaluate(() => ({ ticks: document.querySelectorAll('.changemap .cm-tick').length, dense: !!document.querySelector('.changemap.dense') }));
  const heap = await win.evaluate(() => { window.gc?.(); return +((performance.memory?.usedJSHeapSize || 0) / 1048576).toFixed(1); });
  const mem = await rss(app);
  await app.close();
  return { run, pos, loadMs, phases, scroll, map, memAfterSwitch, memEnd: { ...mem, heapAfterGcMB: heap }, errors };
}

const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
(async () => {
  const runs = [];
  for (let i = 0; i < RUNS; i++) { const r = await once(i + 1); runs.push(r); console.log(JSON.stringify({ run: r.run, load: r.loadMs, phases: r.phases.map((p) => [p.name, p.elapsedMs, p.settleMs, p.longestMs, p.queries]) })); }
  const summary = {};
  for (const name of runs[0].phases.map((p) => p.name)) {
    const ps = runs.map((r) => r.phases.find((p) => p.name === name));
    const s = {};
    for (const k of ['elapsedMs', 'settleMs', 'longestMs', 'p95GapMs', 'maxGapMs', 'domNodes', 'heapMB', 'queries', 'queryMs']) {
      const v = ps.map((p) => p[k]).filter((x) => typeof x === 'number');
      if (v.length) s[k] = { median: med(v), min: Math.min(...v), max: Math.max(...v) };
    }
    summary[name] = s;
  }
  summary.scroll = { p95GapMs: med(runs.map((r) => r.scroll.p95GapMs)), maxGapMs: med(runs.map((r) => r.scroll.maxGapMs)) };
  summary.mem = { rendererMB: med(runs.map((r) => r.memEnd.rendererMB)), heapAfterGcMB: med(runs.map((r) => r.memEnd.heapAfterGcMB)) };
  const out = { label: LABEL, app: APP, version: (() => { try { return require(path.join(APP, 'package.json')).version; } catch { return process.env.APP_VERSION || '?'; } })(), when: new Date().toISOString(),
    machine: { os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), electron: (() => { try { return require(path.join(__dirname, '../node_modules/electron/package.json')).version; } catch { return process.env.ELECTRON_VERSION || 'unknown'; } })() },
    window: `${W}x${H}`, settings: 'default (fresh profile, zh-CN, layout side-by-side)', files: [A, B], countQueries: COUNT, summary, runs };
  const f = path.join(OUT, `${LABEL}${COUNT ? '-queries' : ''}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 1));
  console.log('summary', JSON.stringify(summary));
  console.log('saved', f);
})().catch((e) => { console.error(e); process.exit(1); });
