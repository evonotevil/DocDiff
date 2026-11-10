// 1.9.4 PDF 段落重建：修复前（1.9.3）/ 修复后首次比较的耗时和内存峰值。只用合成夹具（Document A / B）。
// 每个版本每组跑 RUNS 次（全新配置目录、冷启动），从打开到差异列表出来的时间；内存每 200 ms 采样，取峰值（全部进程合计、渲染进程）。
// 用法：OLD=<1.9.3 源码目录> RUNS=3 xvfb-run -a node scripts/perf-pdf-para-194.cjs [结果.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const NEW = process.env.APP || path.join(__dirname, '..');
const OLD = process.env.OLD;
const RUNS = +(process.env.RUNS || 3);
const W = path.join(__dirname, '../work');
const sets = [
  ['120 页（两份）', 'perf-pdf120/pdf120-A.pdf', 'perf-pdf120/pdf120-B.pdf'],
  ['14 页、差异很多', 'fixtures/slow-A.pdf', 'fixtures/slow-B.pdf'],
  ['长段落 1.5 倍行距', 'pdf-align-long/base.pdf', 'pdf-align-long/lead15.pdf'],
];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
(async () => {
  const out = [];
  for (const [name, fa, fb] of sets) {
    for (const [ver, app] of [['1.9.3', OLD], ['1.9.4', NEW]]) {
      if (!app) continue;
      const t = [], peak = [], peakR = [], n = [];
      for (let i = 0; i < RUNS; i++) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-pp-'));
        const A = path.join(dir, 'Document A.pdf'), B = path.join(dir, 'Document B.pdf');
        fs.copyFileSync(path.join(W, fa), A); fs.copyFileSync(path.join(W, fb), B);
        const t0 = Date.now();
        const a = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', app, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-')) } });
        let pk = 0, pkR = 0, stop = false;
        const sample = (async () => { while (!stop) { try { const m = await a.evaluate(({ app }) => app.getAppMetrics().map((x) => ({ t: x.type, w: x.memory.workingSetSize }))); const s = m.reduce((q, x) => q + x.w, 0); pk = Math.max(pk, s); pkR = Math.max(pkR, ...m.filter((x) => x.t === 'Tab' || x.t === 'Renderer').map((x) => x.w)); } catch {} await new Promise((r) => setTimeout(r, 200)); } })();
        const win = await a.firstWindow();
        // 比较完成 = 差异列表出来了（没有差异的话，工具栏位置出来后 3 秒内列表仍为空）
        await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.empty-state'), null, { timeout: 300000 });
        const tPos = Date.now();
        await win.waitForFunction(() => document.querySelectorAll('.dlist .drow').length > 0, null, { timeout: 3000 }).catch(() => {});
        const rowsN = await win.evaluate(() => document.querySelectorAll('.dlist .drow').length);
        t.push((rowsN ? Date.now() : tPos) - t0);
        n.push(rowsN);
        await new Promise((r) => setTimeout(r, 1000));
        stop = true; await sample;
        peak.push(Math.round(pk / 1024)); peakR.push(Math.round(pkR / 1024));
        await a.close();
      }
      const r = { set: name, ver, ms: med(t), all: t, peakMiB: med(peak), rendererMiB: med(peakR), changes: n[0] };
      out.push(r); console.log(JSON.stringify(r));
    }
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
