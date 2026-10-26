// 差异地图位置精度：同一对文件分别用两个版本打开，比较刻度位置。
// 用法：xvfb-run -a node scripts/map-accuracy.cjs <旧版目录> <新版目录> <A> <B> <输出.json>
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const [OLD, NEW, A, B, OUT] = process.argv.slice(2);
const read = async (win) => { for (let i = 0; i < 40; i++) { const r = await read1(win); if (r) return r; await new Promise((x) => setTimeout(x, 250)); } await win.screenshot({ path: '/home/claude/perf/runs/map-accuracy/nomap.png' }); throw new Error('no map'); };
const read1 = (win) => win.evaluate(() => {
  const m = document.querySelector('.changemap');
  if (!m || !m.querySelector('.cm-tick')) return null;
  const dense = m.classList.contains('dense');
  const ticks = [...m.querySelectorAll('.cm-tick')].map((t) => ({ id: t.dataset.tick, top: parseFloat(t.style.top), op: t.style.opacity || '1', k: t.className.match(/k-(\w+)/)?.[1] }));
  return { dense, ticks };
});
async function grab(app0, scrollThrough) {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-'));
  console.error('launch', app0);
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', app0, A, B], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  for (let i = 0; i < 240; i++) { let okk = false; try { okk = await win.evaluate(() => !!document.querySelector('.changemap .cm-tick')); } catch {} if (okk) break; await new Promise((r) => setTimeout(r, 500)); }
  console.error('ready');
  await win.waitForTimeout(2500);
  const first = await read(win);
  let after = null;
  if (scrollThrough) {
    await win.evaluate(async () => { const sc = document.querySelector('.main .scroll'); while (sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2) { sc.scrollTop += sc.clientHeight; await new Promise((r) => setTimeout(r, 60)); } sc.scrollTop = 0; });
    await win.waitForTimeout(1500);
    after = await read(win);
  }
  await app.close();
  return { first, after };
}
const cmp = (o, n) => {
  if (o.dense !== n.dense) return { note: 'dense mismatch' };
  if (!o.dense) {
    const m = new Map(n.ticks.map((t) => [t.id, t.top]));
    const d = o.ticks.map((t) => Math.abs((m.get(t.id) ?? 999) - t.top)).sort((a, b) => a - b);
    return { ticks: [o.ticks.length, n.ticks.length], maxDiffPct: +d[d.length - 1].toFixed(2), p95DiffPct: +d[Math.floor(d.length * 0.95)].toFixed(2), medianDiffPct: +d[d.length >> 1].toFixed(2) };
  }
  const key = (t) => `${Math.round(t.top / (100 / 120))}`;
  const om = new Map(o.ticks.map((t) => [key(t), t])), nm = new Map(n.ticks.map((t) => [key(t), t]));
  const keys = new Set([...om.keys(), ...nm.keys()]);
  let same = 0, near = 0;
  for (const k of keys) { if (om.has(k) && nm.has(k) && om.get(k).k === nm.get(k).k) same++; else if (nm.has(String(+k - 1)) || nm.has(String(+k + 1))) near++; }
  return { buckets: [om.size, nm.size], sameBucketSameKind: same, offByOne: near, of: keys.size };
};
(async () => {
  const o = await grab(OLD, false), n = await grab(NEW, true);
  const res = { files: [A, B], old: OLD, new: NEW, initial: cmp(o.first, n.first), afterScrollThrough: cmp(o.first, n.after), raw: { old: o.first, new: n } };
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
  console.log(JSON.stringify({ initial: res.initial, afterScrollThrough: res.afterScrollThrough }));
})();
