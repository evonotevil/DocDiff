// 连续操作 3 分钟（J/K、滚动、筛选、切换富文本 / 纯文本 / 修订审阅 / 图像），每 10 秒记一次渲染进程内存和 JS 堆；
// 结束后空闲 20 秒并强制 GC，看内存能否回落。同时记录每个操作从输入到下一帧的耗时、主线程是否有超过 1 秒无响应。
// 用法：APP=<应用目录> SOAK_S=180 xvfb-run -a node scripts/soak-pdf-compare.cjs <A.pdf> <B.pdf> <输出.json>
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const SOAK = +(process.env.SOAK_S || 180) * 1000;
const [A, B, OUT] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '--js-flags=--expose-gc', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'soak-')) } });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  const mem = async () => {
    const m = await app.evaluate(({ app }) => { const ms = app.getAppMetrics(); const r = ms.find((x) => x.type === 'Tab' || x.type === 'Renderer'); return { rendererMB: Math.round((r?.memory.workingSetSize || 0) / 1024), totalMB: Math.round(ms.reduce((s, x) => s + x.memory.workingSetSize, 0) / 1024) }; });
    const h = await Promise.race([win.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576)), new Promise((r) => setTimeout(() => r(null), 3000))]);
    return { ...m, heapMB: h };
  };
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') && !document.querySelector('.main .spinner'), null, { timeout: 180000, polling: 100 });
  const samples = [{ t: 0, ...(await mem()) }];
  const lat = {};
  const add = (k, v) => (lat[k] ||= []).push(v);
  const frame = () => win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const act = async (k, fn) => { const s = Date.now(); await fn(); await frame(); add(k, Date.now() - s); };
  const tab = (i) => win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i);
  const chip = (re) => win.evaluate((re) => [...document.querySelectorAll('.chips .fchip')].find((b) => new RegExp(re).test(b.textContent))?.click(), re);
  const t0 = Date.now(); let lastS = t0, round = 0;
  const MAXR = +(process.env.SOAK_ROUNDS || 1e9);
  while (Date.now() - t0 < SOAK && round < MAXR) {
    round++;
    await act('tab', () => tab(0));
    for (let i = 0; i < 6; i++) await act('J', () => win.keyboard.press('j'));
    for (let i = 0; i < 3; i++) await act('K', () => win.keyboard.press('k'));
    for (let i = 0; i < 10; i++) await act('scroll', () => win.evaluate(() => { const s = document.querySelector('.main .scroll'); if (s) s.scrollTop += s.clientHeight; }));
    await act('filter', () => chip('新增')); await act('filter', () => chip('全部'));
    await act('tab', () => tab(1)); await win.waitForTimeout(300);
    await act('tab', () => tab(2)); await win.waitForTimeout(300);
    if (round % 3 === 1) { await act('tab', () => tab(3)); await win.waitForTimeout(2500); }   // 图像模式（中途切走也算一种操作）
    if (Date.now() - lastS > 10000) { lastS = Date.now(); samples.push({ t: Date.now() - t0, ...(await mem()) }); }
  }
  await tab(0);
  await win.waitForTimeout(20000);
  await win.evaluate(async () => { for (let i = 0; i < 3; i++) { window.gc?.(); await new Promise((r) => setTimeout(r, 200)); } });
  await win.waitForTimeout(3000);
  const after = await mem();
  const stat = (a) => { const s = [...a].sort((x, y) => x - y); return { n: s.length, median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], max: s[s.length - 1] }; };
  const out = { app: APP, soakMs: SOAK, rounds: round, samples, peakRendererMB: Math.max(...samples.map((x) => x.rendererMB)), peakTotalMB: Math.max(...samples.map((x) => x.totalMB)), afterIdleGc: after, latency: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, stat(v)])) };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ rounds: round, peakRendererMB: out.peakRendererMB, peakTotalMB: out.peakTotalMB, afterIdleGc: after, latency: out.latency }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
