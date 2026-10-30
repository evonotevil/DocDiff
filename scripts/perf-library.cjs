// 模板 / 往来稿的性能（1.8 预算）：库里有 20 个模板（各 3 版）、10 份往来稿（各 10 版，约 100 页）时，
// 首页打开耗时、放入对方文件后认出往来稿的耗时、打开往来稿、审阅时切换修订（带上轮提示和条款历史）的耗时。
// 用法：APP=<应用目录> xvfb-run -a node scripts/perf-library.cjs [输出.json] [--empty]
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/review-fixtures');
const OUT = process.argv[2];
const EMPTY = process.argv.includes('--empty');
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-perf-'));
const res = {};

(async () => {
  // 准备：拿到应用数据目录，写入一个“很满”的库
  let app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  const ud = await app.evaluate(({ app }) => app.getPath('userData'));
  // 指纹用应用自己的算法在页面里算（保证和实际一致）
  let win = await app.firstWindow();
  await win.waitForSelector('.lib-card', { timeout: 60000 });
  await app.close();
  const libDir = path.join(ud, 'library'), files = path.join(libDir, 'files');
  fs.mkdirSync(files, { recursive: true });
  const put = (p) => { const b = fs.readFileSync(p); const sha = crypto.createHash('sha256').update(b).digest('hex'); fs.writeFileSync(path.join(files, sha + '.docx'), b); return { sha, ext: 'docx', size: b.length, name: path.basename(p), mtime: Date.now() }; };
  const fA = put(path.join(FIX, 'huge-A.docx')), fB = put(path.join(FIX, 'huge-B.docx'));
  // 指纹：随机但规模真实（每版约 1700 段）；huge-A/B 的真实指纹在页面里算好后替换进最后一份往来稿
  const rnd = (n) => Array.from({ length: n }, () => (Math.random() * 2 ** 32) >>> 0).sort((a, b) => a - b);
  const now = Date.now();
  const ix = { v: 1, templates: [], threads: [] };
  if (!EMPTY) {
    for (let i = 0; i < 20; i++) ix.templates.push({ id: 't' + i, name: `模板 ${i}`, created: now, updated: now, versions: [0, 1, 2].map((k) => ({ id: `t${i}v${k}`, label: `2026-0${k + 1}`, added: now, file: fA, fp: rnd(1700) })) });
    for (let i = 0; i < 10; i++) {
      const versions = Array.from({ length: 10 }, (_, k) => ({ id: `h${i}v${k}`, n: k + 1, side: k % 2 ? 'theirs' : 'ours', added: now, file: k % 2 ? fB : fA, fp: rnd(1700) }));
      const rounds = versions.slice(1).map((v, k) => ({ a: versions[k].id, b: v.id, pk: 'x', total: 500, decided: 480, updated: now, items: Array.from({ length: 300 }, (_, j) => ({ clause: `第${j % 40}章 条款`, before: '甲方应在收到发票后三十日内付款'.slice(0, 5 + (j % 10)), after: '甲方应在收到发票后六十日内付款', v: ['a', 'r', 'h'][j % 3] })) }));
      ix.threads.push({ id: 'h' + i, name: `往来稿 ${i}`, created: now, updated: now, versions, rounds });
    }
  }
  // 和应用一样的存法：指纹 base64、各轮结论摘要单独成文件
  const enc = (fp) => Buffer.from(new Uint32Array(fp).buffer).toString('base64');
  fs.mkdirSync(path.join(libDir, 'rounds'), { recursive: true });
  for (const t of ix.threads) { fs.writeFileSync(path.join(libDir, 'rounds', t.id + '.json'), JSON.stringify(t.rounds)); t.rounds = t.rounds.map(({ items, ...r }) => r); }
  for (const t of [...ix.templates, ...ix.threads]) for (const v of t.versions) v.fp = enc(v.fp);
  fs.writeFileSync(path.join(libDir, 'index.json'), JSON.stringify(ix));
  res.indexKB = Math.round(fs.statSync(path.join(libDir, 'index.json')).size / 1024);

  // 1. 首页打开
  let t0 = Date.now();
  app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction((n) => document.querySelectorAll('.lib-row').length >= n, EMPTY ? 0 : 30, { timeout: 60000 });
  res.homeReadyMs = Date.now() - t0;
  // 把最后一份往来稿的第 9、10 版换成真实的 huge-A / huge-B 指纹（用应用的指纹函数）
  // 2. 放入对方文件：认出来要多久（从文件读完到提示出现）
  if (!EMPTY) {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, path.join(FIX, 'huge-B.docx'));
    t0 = Date.now();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('menu', 'open-right'));
    await win.waitForFunction(() => /DOCX/.test(document.querySelectorAll('.drop')[1]?.innerText || '') || !!document.querySelector('.drop.has'), null, { timeout: 60000 }).catch(() => {});
    const tLoaded = Date.now();
    // 随机指纹不会命中；这里量的是“读完 → 首页重算候选并渲染完”的时间（含 30 份候选 × 10 版的比对）
    await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    res.loadVendorMs = tLoaded - t0;
    res.matchAfterLoadMs = Date.now() - tLoaded;
    // 直接在页面里量一次识别算法本身（指纹 + 300 个候选比对）
    res.recognitionMs = await win.evaluate(() => {
      const fp = Array.from({ length: 1700 }, () => (Math.random() * 2 ** 32) >>> 0).sort((a, b) => a - b);
      const cands = Array.from({ length: 360 }, () => Array.from({ length: 1700 }, () => (Math.random() * 2 ** 32) >>> 0).sort((a, b) => a - b));
      const t = performance.now();
      for (const v of cands) { let i = 0, j = 0, n = 0; while (i < v.length && j < fp.length) { if (v[i] === fp[j]) { n++; i++; j++; } else if (v[i] < fp[j]) i++; else j++; } }
      return Math.round(performance.now() - t);
    });
  }
  // 3. 打开一份往来稿（第 1 份：V9 → V10，约 100 页、556 处差异），切到修订审阅，逐处切换
  if (!EMPTY) {
    await win.evaluate(() => [...document.querySelectorAll('.drop .btn')].find((b) => /移除|Remove/.test(b.textContent))?.click());
    t0 = Date.now();
    await win.evaluate(() => [...document.querySelectorAll('.lib-card[aria-label="往来稿"] .lib-row')][0].click());
    await win.waitForFunction(() => !!document.querySelector('.ver-chip') && !!document.querySelector('.tb-prog, .tb-pos'), null, { timeout: 120000 });
    res.openThreadMs = Date.now() - t0;
    await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
    await win.waitForTimeout(1500);
    await win.evaluate(() => { window.__long = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask' }); } catch {} });
    const lat = [];
    for (let i = 0; i < 20; i++) {
      const s = Date.now();
      await win.keyboard.press('j');
      await win.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      lat.push(Date.now() - s);
    }
    lat.sort((a, b) => a - b);
    res.reviewJ = { median: lat[lat.length >> 1], p95: lat[Math.floor(lat.length * 0.95)], max: lat[lat.length - 1] };
    res.reviewLongTasks = await win.evaluate(() => window.__long);
    res.hasHistoryPanel = await win.evaluate(() => !!document.querySelector('.clause-hist'));
  }
  await app.close();
  console.log(JSON.stringify(res));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify(res, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
