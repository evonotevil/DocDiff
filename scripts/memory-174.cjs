// 多轮“打开 → 比较 → 切换模式 → 新建比较”内存回归。用法：APP=<应用目录> ROUNDS=8 xvfb-run -a node scripts/memory-174.cjs <输出.json>
// 每轮记录：渲染进程 RSS、JS 堆（当时 / 强制 GC 后）、页面图片缓存（1.7.4 起有 __ddPageStats）、DOM 节点数。
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FX = process.env.PERF_FIX || '/home/claude/perf/win/outputs/fixtures';
const ROUNDS = +(process.env.ROUNDS || 8);
const OUT = process.argv[2];
const PAIRS = [
  { name: 'word-3000', a: `${FX}/word-3000-a.docx`, b: `${FX}/word-3000-b.docx`, image: false },
  { name: 'vector-pdf-30', a: `${FX}/vector-pdf-30-a.pdf`, b: `${FX}/vector-pdf-30-b.pdf`, image: true },
  { name: 'word-1250', a: `${FX}/word-1250-a.docx`, b: `${FX}/word-1250-b.docx`, image: true },
  { name: 'pdf-30-raster', a: `${FX}/pdf-30-a.pdf`, b: `${FX}/pdf-30-b.pdf`, image: true },
].filter((p) => !process.env.ONLY || process.env.ONLY.split(',').includes(p.name));
const READY = () => (!!document.querySelector('.main .scroll') || !!document.querySelector('.main .empty-state')) && !document.querySelector('.main .spinner');
(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'));
  const first = PAIRS[0];
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', APP, first.a, first.b], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const win = await app.firstWindow(); globalThis.__win = win; await win.setViewportSize({ width: 1440, height: 900 });
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  const nav = async (i, ready = READY) => { await win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i); await win.waitForFunction(ready, null, { timeout: 900000, polling: 250 }); await win.waitForTimeout(500); };
  const sample = async (round, pair, stage) => {
    const pre = await win.evaluate(() => ({ heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), dom: document.getElementsByTagName('*').length }));
    const gc = await win.evaluate(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 100)); } return { heapAfterGcMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), pages: window.__ddPageStats ? window.__ddPageStats() : null }; });
    const m = await app.evaluate(({ app }) => { const ms = app.getAppMetrics(); const r = ms.find((x) => x.type === 'Tab' || x.type === 'Renderer'); return { rendererMB: Math.round((r?.memory.workingSetSize || 0) / 1024), totalMB: Math.round(ms.reduce((s, x) => s + x.memory.workingSetSize, 0) / 1024), gpuMB: Math.round((ms.find((x) => x.type === 'GPU')?.memory.workingSetSize || 0) / 1024) }; });
    const s = { round, pair, stage, ...m, ...pre, ...gc };
    console.log(JSON.stringify(s));
    return s;
  };
  const samples = [];
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !document.querySelector('.main .spinner'), null, { timeout: 120000 });
  samples.push(await sample(0, 'idle-after-launch', 'start'));
  for (let r = 1; r <= ROUNDS; r++) {
    const p = PAIRS[(r - 1) % PAIRS.length];
    if (r > 1) {
      await win.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => b.title === '新建比较' || b.textContent.includes('新建比较')).click());
      await win.waitForSelector('.home-cta', { timeout: 30000 });
      for (const [i, f] of [p.a, p.b].entries()) {
        await app.evaluate(({ BrowserWindow }, f) => BrowserWindow.getAllWindows()[0].webContents.send('open-path', f), f);
        await win.waitForFunction((n) => document.querySelectorAll('.drop.filled').length >= n, i + 1, { timeout: 120000 });
      }
      await win.click('.home-cta button:not([disabled])');
    }
    await win.waitForFunction(() => !!document.querySelector('.tbar') && (!!document.querySelector('.main .scroll') || !!document.querySelector('.main .empty-state')) && !document.querySelector('.main .spinner'), null, { timeout: 300000, polling: 100 });
    const badges = await win.evaluate(() => [...document.querySelectorAll('.nav-list .nav-item')].slice(0, 3).map((n) => n.textContent.replace(/\s+/g, ' ').trim()));
    console.error('badges', JSON.stringify(badges));
    await win.waitForTimeout(800);
    await nav(1); await nav(2); await nav(0);
    if (p.image) {
      const t0 = Date.now();
      await nav(3, () => { const rl = document.querySelector('.range-line'); if (rl && rl.dataset.phase) return rl.dataset.phase === 'done'; return !!document.querySelector('.pagepair') && !document.querySelector('.imgview .spinner') && !document.querySelector('.main .spinner'); });
      console.error(`image ${p.name}: ${Date.now() - t0} ms`);
      await nav(0);
    }
    samples.push(await sample(r, p.name, 'after-modes'));
  }
  await app.close();
  const byPair = {};
  for (const s of samples.filter((x) => x.round > 0)) (byPair[s.pair] ||= []).push(s.heapAfterGcMB);
  const out = { app: APP, version: (() => { try { return require(path.join(APP, 'package.json')).version; } catch { return process.env.APP_VERSION || '?'; } })(), when: new Date().toISOString(), machine: `${os.platform()} ${os.cpus()[0]?.model} x${os.cpus().length}, ${Math.round(os.totalmem() / 2 ** 30)} GB`, rounds: ROUNDS, window: '1440x900', samples, heapAfterGcByPair: byPair, errors: errs };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log('saved', OUT);
})().catch(async (e) => { console.error(e); try { await globalThis.__win?.screenshot({ path: OUT.replace(/\.json$/, '-fail.png') }); } catch {} process.exit(1); });
