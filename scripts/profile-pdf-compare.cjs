// 两份 PDF 打开 → 富文本结果 → 交互 → 图像模式，全程记录主线程是否响应、长任务、DOM、内存，并保存 CPU profile 和 performance trace。
// 只用合成夹具（scripts/make-slow-pdf-fixtures.py 生成），日志里文档一律称 Document A / Document B。
// 用法：APP=<应用目录> xvfb-run -a node scripts/profile-pdf-compare.cjs <A.pdf> <B.pdf> <输出目录> [--trace] [--no-image]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B, OUT] = process.argv.slice(2);
const TRACE = process.argv.includes('--trace');
const IMAGE = !process.argv.includes('--no-image');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const t0 = Date.now();
const note = (ev, extra = {}) => { const e = { t: Date.now() - t0, ev, ...extra }; log.push(e); console.log(JSON.stringify(e)); };

// 页面里装观察器：长任务、帧间隔
const INSTALL = () => {
  if (window.__obs) return;
  const o = window.__obs = { long: [], gaps: [], last: performance.now() };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) o.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch {}
  const f = (t) => { o.gaps.push([Math.round(t), +(t - o.last).toFixed(1)]); o.last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
};
const SNAP = () => ({
  now: Math.round(performance.now()),
  stage: document.querySelector('.main .empty-state')?.innerText?.replace(/\s+/g, ' ').slice(0, 60) || '',
  pos: document.querySelector('.tb-pos')?.textContent || '',
  dom: document.getElementsByTagName('*').length,
  heapMB: Math.round((performance.memory?.usedJSHeapSize || 0) / 1048576),
});
// 主线程是否在 1 秒内响应
async function probe(win, ms = 1000) {
  const s = Date.now();
  const r = await Promise.race([win.evaluate(SNAP).catch(() => null), new Promise((res) => setTimeout(() => res('BLOCKED'), ms))]);
  return { lat: Date.now() - s, r };
}
async function procMem(app) {
  return app.evaluate(({ app }) => { const m = app.getAppMetrics(); const r = m.find((x) => x.type === 'Tab' || x.type === 'Renderer'); return { rendererMB: Math.round((r?.memory.workingSetSize || 0) / 1024), totalMB: Math.round(m.reduce((s, x) => s + x.memory.workingSetSize, 0) / 1024) }; });
}

(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'prof-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  note('window');
  const cdp = await win.context().newCDPSession(win);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
  await cdp.send('Profiler.start');
  let traceChunks = [];
  if (TRACE) {
    cdp.on('Tracing.dataCollected', (d) => traceChunks.push(...d.value));
    await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8.execute,blink.user_timing', transferMode: 'ReportEvents' });
  }
  await win.evaluate(INSTALL).catch(() => {});
  // 1. 打开到出结果：每 250 ms 探测一次主线程
  let ready = false, blocked = 0, maxLat = 0;
  const stages = new Set();
  for (let i = 0; i < 1200 && !ready; i++) {
    const p = await probe(win);
    maxLat = Math.max(maxLat, p.lat);
    if (p.r === 'BLOCKED') { blocked++; note('blocked>1s'); continue; }
    if (p.r?.stage && !stages.has(p.r.stage)) { stages.add(p.r.stage); note('stage', { text: p.r.stage }); }
    if (p.r?.pos) { ready = true; note('result', p.r); }
    await new Promise((r) => setTimeout(r, 250));
  }
  const tResult = Date.now() - t0;
  await win.evaluate(INSTALL);
  const afterResult = await win.evaluate(SNAP);
  note('after-result', { ...afterResult, ...(await procMem(app)) });
  // 2. 刚出结果：立刻滚动、J/K、筛选；每个操作计输入到下一帧
  const act = async (name, fn) => {
    const s = Date.now();
    await fn();
    await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const ms = Date.now() - s; note('action', { name, ms }); return ms;
  };
  const acts = {};
  acts.j1 = await act('J', () => win.keyboard.press('j'));
  acts.j2 = await act('J', () => win.keyboard.press('j'));
  acts.k = await act('K', () => win.keyboard.press('k'));
  acts.scroll = await act('scroll 2 screens', () => win.evaluate(() => { const s = document.querySelector('.main .scroll'); s.scrollTop += s.clientHeight * 2; }));
  acts.filterIns = await act('filter ins', () => win.evaluate(() => [...document.querySelectorAll('.chips .fchip')].find((b) => /新增/.test(b.textContent))?.click()));
  acts.filterAll = await act('filter all', () => win.evaluate(() => [...document.querySelectorAll('.chips .fchip')].find((b) => /全部/.test(b.textContent))?.click()));
  const scroll = await win.evaluate(async () => {
    const el = document.querySelector('.main .scroll'); const g = []; let last = performance.now();
    await new Promise((res) => { const end = performance.now() + 3000; const f = (t) => { g.push(t - last); last = t; el.scrollTop += 60; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    g.sort((a, b) => a - b); return { frames: g.length, fps: +(g.length / 3).toFixed(1), p95: +g[Math.floor(g.length * 0.95)].toFixed(1), max: +g[g.length - 1].toFixed(1) };
  });
  note('scroll', scroll);
  for (const [i, n] of [[1, 'plain'], [2, 'review'], [0, 'rich']]) acts['tab-' + n] = await act('tab ' + n, () => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i));
  // 3. 图像模式
  let image = null;
  if (IMAGE) {
    const s = Date.now();
    await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click());
    let iblocked = 0, ilat = 0, done = false;
    for (let i = 0; i < 600 && !done; i++) {
      const p = await probe(win);
      ilat = Math.max(ilat, p.lat);
      if (p.r === 'BLOCKED') { iblocked++; continue; }
      done = await win.evaluate(() => document.querySelector('.range-line')?.dataset.phase === 'done').catch(() => false);
      await new Promise((r) => setTimeout(r, 250));
    }
    image = { ms: Date.now() - s, blocked: iblocked, maxProbeLatency: ilat, ...(await procMem(app)), heapMB: (await win.evaluate(SNAP)).heapMB };
    note('image', image);
    acts['tab-rich-from-image'] = await act('tab rich', () => win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click()));
  }
  const obs = await win.evaluate(() => window.__obs);
  const prof = await cdp.send('Profiler.stop');
  fs.writeFileSync(path.join(OUT, 'cpu.cpuprofile'), JSON.stringify(prof.profile));
  if (TRACE) {
    const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
    await cdp.send('Tracing.end'); await done;
    fs.writeFileSync(path.join(OUT, 'trace.json'), JSON.stringify({ traceEvents: traceChunks }));
  }
  const gcHeap = await win.evaluate(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 100)); } return Math.round(performance.memory.usedJSHeapSize / 1048576); });
  const end = { ...(await win.evaluate(SNAP)), heapAfterGcMB: gcHeap, ...(await procMem(app)) };
  const longs = obs.long.sort((a, b) => b[1] - a[1]);
  const summary = {
    version: (() => { try { return require(path.join(APP, 'package.json')).version; } catch { return '?'; } })(),
    machine: `${os.platform()} ${os.cpus()[0]?.model} x${os.cpus().length}`, docs: 'Document A / Document B (synthetic)',
    openToResultMs: tResult, blockedProbesDuringOpen: blocked, maxProbeLatencyDuringOpen: maxLat, stages: [...stages],
    afterResult, actions: acts, scroll, image, end,
    longTasks: { count: longs.length, over200: longs.filter((x) => x[1] > 200).length, top: longs.slice(0, 8), totalMs: longs.reduce((s, x) => s + x[1], 0) },
  };
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify(log, null, 1));
  console.log('SUMMARY ' + JSON.stringify(summary));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
