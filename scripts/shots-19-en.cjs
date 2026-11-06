// 1.9 英文界面走查（只用合成夹具）：每个界面检查有没有漏翻（出现中文），并截图（浅色 / 深色，960 / 1440）。
// PSEUDO=1 时英文统一加长 40%，检查文字是否被截断或撑出容器。
// 用法：APP=<应用目录> [PSEUDO=1] xvfb-run -a node scripts/shots-19-en.cjs [输出目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/shots-19-en');
const PSEUDO = process.env.PSEUDO === '1';
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work/review-fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-en-'));
const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx');
fs.copyFileSync(path.join(FIX, 'basic-A.docx'), A); fs.copyFileSync(path.join(FIX, 'basic-B.docx'), B);
const leaks = new Map();
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info).slice(0, 600) : ''}`); };

// 界面上的中文：去掉文档正文（.paper / 画布）、文件名、语言切换里的“中文”
const scan = (win, where) => win.evaluate(() => {
  const skip = (el) => el.closest('.paper, .canvas-scroll, .rich, .plain, .redline, .page-pair, .doc, .blk, .ct, .drow .tx, .dlist .drow, .cur-chg, .ver-chip, .tb-file, .filechip, .lib-row .nm, .lib-row .meta, .ins-quote, .clause-h, .ocr, .details, .dlist, .grp[title], .rb-where, .rb-diff, [data-userdata]');
  const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const s = n.nodeValue.trim(); if (!s || !/[一-鿿]/.test(s) || s === '中文' || s.startsWith('Language / 语言')) continue;
    const el = n.parentElement; if (!el || skip(el) || !el.getClientRects().length) continue;
    out.add(s.slice(0, 60) + '  <' + (el.className || el.tagName) + ' / ' + (el.parentElement?.className || '') + '>');
  }
  for (const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) for (const a of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(a); if (v && /[一-鿿]/.test(v) && v !== '中文' && !skip(el)) out.add(`@${a}: ${v.slice(0, 60)}`); }
  return [...out];
}).then((xs) => { for (const x of xs) { if (!leaks.has(x)) leaks.set(x, where); } });

// 伪本地化：文字溢出容器（没有省略号的）
const overflow = (win) => win.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('button, .btn, .opt-text span, .sh, .nav-item .lbl, .tb-pos, .seg button, .chip, .modal-head h2, .set-tabs button, label')) {
    const cs = getComputedStyle(el);
    if (!el.getClientRects().length || cs.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible') out.push(el.textContent.trim().slice(0, 40));
  }
  return out.slice(0, 20);
});

(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=' + (process.env.UILANG || 'en-US'), APP], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  let win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  if (PSEUDO) { await win.evaluate(() => localStorage.setItem('docdiff.pseudo', '1')); await win.reload(); }
  await win.waitForSelector('.home-cta');
  const lang = await win.evaluate(() => document.documentElement.lang);
  ok('English UI', lang === 'en', { lang });
  const shotsAt = async (name) => {
    for (const w of [960, 1440]) for (const theme of ['light', 'dark']) {
      await win.setViewportSize({ width: w, height: 860 });
      await win.evaluate((th) => { document.documentElement.dataset.theme = th; }, theme);
      await win.waitForTimeout(120);
      await win.screenshot({ path: path.join(OUT, `${name}-${w}-${theme}.png`) });
    }
    await win.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await win.setViewportSize({ width: 1360, height: 860 });
  };
  const step = async (name) => { await scan(win, name); if (PSEUDO) { const o = await overflow(win); if (o.length) console.log(`  overflow @${name}:`, o); } await shotsAt(name); };
  await win.setViewportSize({ width: 1360, height: 860 });
  await step('01-home');
  // 设置：每个分页
  await win.evaluate(() => document.querySelector('.home-top button[aria-label]').click()); await win.waitForTimeout(300);
  const tabs = await win.evaluate(() => [...document.querySelectorAll('.set-tabs button')].map((b) => b.textContent));
  for (let i = 0; i < tabs.length; i++) {
    await win.evaluate((i) => document.querySelectorAll('.set-tabs button')[i].click(), i); await win.waitForTimeout(200);
    if (i === tabs.length - 1) { await win.evaluate(() => document.querySelector('.dex-toggle')?.click()); await win.waitForTimeout(150); }
    await step(`02-settings-${i}`);
  }
  await win.keyboard.press('Escape'); await win.waitForTimeout(200);
  // 载入两份
  for (const [i, f] of [[0, A], [1, B]]) {
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, f);
    await win.evaluate((i) => [...document.querySelectorAll('.drops .drop')][i].querySelector('button').click(), i); await win.waitForTimeout(1200);
  }
  await step('03-ready');
  await win.keyboard.press('Enter');
  await win.waitForFunction(() => !!document.querySelector('.tb-pos') || !!document.querySelector('.tb-prog'), null, { timeout: 60000 });
  await win.waitForTimeout(500);
  const modes = await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item').length);
  for (let i = 0; i < modes; i++) {
    await win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i); await win.waitForTimeout(900);
    if (i === 2) await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /OK|Got/.test(b.textContent))?.click());
    await step(`04-mode-${i}`);
  }
  // 审阅：做几个决定、打开弹出层和弹窗
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(500);
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await win.waitForTimeout(150);
  await win.keyboard.press('a'); await win.waitForTimeout(300); await win.keyboard.press('h'); await win.waitForTimeout(300);
  await step('05-review');
  await win.evaluate(() => document.querySelector('.ibtn.sm.act')?.click()); await win.waitForTimeout(200);
  await step('06-more-menu');
  await win.evaluate(() => [...document.querySelectorAll('.pop .menu-item')][0]?.click()); await win.waitForTimeout(300);
  await step('07-bulk');
  await win.evaluate(() => document.querySelector('.bulk-ask .btn.primary, .bulk-ask .btn.red')?.click()); await win.waitForTimeout(1000);
  await step('08-done');
  await win.evaluate(() => document.querySelector('.tb-export')?.click()); await win.waitForTimeout(400);
  await step('09-export');
  await win.keyboard.press('Escape'); await win.waitForTimeout(200);
  await win.evaluate(() => document.querySelector('[aria-label="Scope"], .insp-foot .link-btn')?.click()); await win.waitForTimeout(200);
  await step('10-scope');
  await win.keyboard.press('Escape');
  await win.evaluate(() => document.querySelector('.tb-copy')?.click()); await win.waitForTimeout(300);
  await step('11-toast');
  // 1.9.1：查找栏、文件片菜单、老用户首页（两个页签）
  await win.waitForTimeout(3500);
  await win.keyboard.press('Control+f'); await win.waitForTimeout(200); await win.keyboard.type('the'); await win.waitForTimeout(500);
  await step('12-find');
  await win.keyboard.press('Escape');
  await win.evaluate(() => document.querySelector('.filechip')?.click()); await win.waitForTimeout(250);
  await step('13-filechip-menu');
  await win.keyboard.press('Escape');
  await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0]?.click()); await win.waitForTimeout(800);
  await step('14-home-recent');
  await win.evaluate(() => document.querySelectorAll('.mod-tabs button')[1]?.click()); await win.waitForTimeout(200);
  await step('15-home-negotiations');

  const L = [...leaks.entries()];
  ok('no Chinese left in the English UI', !L.length, L.map(([s, w]) => `${w}: ${s}`));
  ok('no page errors', !errs.length, { errs });
  await app.close();
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
