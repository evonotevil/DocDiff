// 结果刚出来时立刻操作的响应时间。用法：APP=<目录> RUNS=3 xvfb-run -a node scripts/bench-immediate.cjs <A> <B> <标签> <输出目录>
// 结果出现（.tb-pos）后立刻：① 点“下一处”，计到选中的差异出现在视口里；② 再点差异地图 30% 处，计到滚动位置变化并画完两帧。
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const RUNS = +(process.env.RUNS || 3);
const [A, B, LABEL, OUT] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
(async () => {
  const runs = [];
  for (let r = 0; r < RUNS; r++) {
    const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'imm-'));
    const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
    const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !!document.querySelector('.main .scroll') && !document.querySelector('.main .spinner'), null, { timeout: 180000, polling: 16 });
    const res = await win.evaluate(async () => {
      const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const sc = document.querySelector('.main .scroll');
      const t0 = performance.now();
      document.querySelector('button[aria-label="下一处"]').click();
      let next = -1;
      for (let i = 0; i < 2000; i++) {
        await new Promise((r) => setTimeout(r, 5));
        const id = document.querySelector('.dlist .drow.sel')?.getAttribute('data-chg');
        const el = id && sc.querySelector(`[data-cid="${id}"]`);
        if (el) { const a = el.getBoundingClientRect(), s = sc.getBoundingClientRect(); if (a.bottom > s.top && a.top < s.bottom) { await frames(); next = performance.now() - t0; break; } }
      }
      const m = document.querySelector('.changemap');
      const before = sc.scrollTop;
      const r = m.getBoundingClientRect();
      const t1 = performance.now();
      m.dispatchEvent(new PointerEvent('pointerdown', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.3, bubbles: true, pointerId: 1 }));
      m.dispatchEvent(new PointerEvent('pointerup', { clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.3, bubbles: true, pointerId: 1 }));
      let map = -1;
      for (let i = 0; i < 2000; i++) { if (sc.scrollTop !== before) { await frames(); map = performance.now() - t1; break; } await new Promise((r) => setTimeout(r, 5)); }
      return { firstNextMs: Math.round(next), mapClickMs: Math.round(map) };
    });
    runs.push(res); console.log(JSON.stringify(res));
    await app.close();
  }
  const out = { label: LABEL, app: APP, version: (() => { try { return require(path.join(APP, 'package.json')).version; } catch { return process.env.APP_VERSION || '?'; } })(), machine: `${os.platform()} ${os.cpus()[0]?.model} x${os.cpus().length}`, window: '1440x900', runs,
    firstNextMs: { median: med(runs.map((x) => x.firstNextMs)), min: Math.min(...runs.map((x) => x.firstNextMs)), max: Math.max(...runs.map((x) => x.firstNextMs)) },
    mapClickMs: { median: med(runs.map((x) => x.mapClickMs)), min: Math.min(...runs.map((x) => x.mapClickMs)), max: Math.max(...runs.map((x) => x.mapClickMs)) } };
  fs.writeFileSync(path.join(OUT, `${LABEL}-immediate.json`), JSON.stringify(out, null, 1));
  console.log('summary', JSON.stringify({ next: out.firstNextMs, map: out.mapClickMs }));
})().catch((e) => { console.error(e); process.exit(1); });
