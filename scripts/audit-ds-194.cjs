// 1.9.4 设计系统走查：逐屏截图 + 统计可交互元素的计算样式（只用合成夹具，文件名一律 Document A / B）
// 用法：xvfb-run -a node scripts/audit-ds-194.cjs [输出目录]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/audit-194');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work/review-fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-audit-'));
const F = (n) => path.join(dir, `Document ${n}.docx`);
fs.copyFileSync(path.join(FIX, 'neg-V1.docx'), F('A')); fs.copyFileSync(path.join(FIX, 'neg-V2.docx'), F('B')); fs.copyFileSync(path.join(FIX, 'neg-V3.docx'), F('C'));
const PA = path.join(dir, 'Document A.pdf'), PB = path.join(dir, 'Document B.pdf');
fs.copyFileSync(path.join(__dirname, '../work/pdf-align/base.pdf'), PA); fs.copyFileSync(path.join(__dirname, '../work/pdf-align/same.pdf'), PB);
const all = [];
async function audit(win, name) {
  await win.screenshot({ path: path.join(OUT, name + '.png') });
  const r = await win.evaluate(() => {
    const sel = 'button, input, select, textarea, [role=tab], [role=switch], .btn, .chip, .tag, .badge, .nb, .seg, .filechip, .ver-chip, .menu-item, .nav-item, .pop, .modal, .nt, .toast, h1, h2, h3, h4, .set-sh, .sh, .grp';
    return [...document.querySelectorAll(sel)].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; }).map((e) => {
      const s = getComputedStyle(e), b = e.getBoundingClientRect();
      return { tag: e.tagName.toLowerCase(), type: e.type || '', cls: (e.className && e.className.baseVal === undefined ? e.className : '').toString().slice(0, 60), text: (e.innerText || e.value || '').trim().slice(0, 24).replace(/\n/g, ' '),
        h: Math.round(b.height), rad: s.borderTopLeftRadius, bw: s.borderTopWidth, bc: s.borderTopColor, bs: s.borderTopStyle, fs: s.fontSize, fw: s.fontWeight, ff: s.fontFamily.split(',')[0], bg: s.backgroundColor, sh: s.boxShadow === 'none' ? '' : s.boxShadow.slice(0, 60), appearance: s.appearance };
    });
  });
  r.forEach((x) => all.push({ screen: name, ...x }));
}
(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  const launch = async (args = []) => {
    const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
    const win = await app.firstWindow(); await win.setViewportSize({ width: 1280, height: 820 }); return { app, win };
  };
  const clickText = (win, s, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [s, re]);
  let { app, win } = await launch();
  await win.waitForSelector('.home-cta'); await sleep(600);
  await audit(win, '01-home-first');
  await win.evaluate(() => document.querySelector('.home-top button[aria-label="设置"]')?.click()); await sleep(400);
  const tabs = await win.evaluate(() => document.querySelectorAll('.set-tabs [role=tab]').length);
  for (let i = 0; i < tabs; i++) { await win.evaluate((i) => document.querySelectorAll('.set-tabs [role=tab]')[i].click(), i); await sleep(300); await audit(win, `02-settings-${i}`); }
  await win.keyboard.press('Escape'); await sleep(300);
  await clickText(win, '.drops .drop .btn', '粘贴'); await sleep(400); await audit(win, '03-paste'); await win.keyboard.press('Escape'); await sleep(300);
  await app.close();

  ({ app, win } = await launch([F('A'), F('B')]));
  await win.waitForFunction(() => !!document.querySelector('.tb-prog') || !!document.querySelector('.tb-pos') || !!document.querySelector('.dlist'), null, { timeout: 60000 }); await sleep(1500);
  const modes = ['rich', 'plain', 'redline', 'image', 'ocr', 'details'];
  for (let i = 0; i < 6; i++) {
    if (i === 4) continue; // OCR 会开始识别，跳过
    await win.evaluate((i) => document.querySelectorAll('.nav-list .nav-item')[i].click(), i); await sleep(1500);
    if (i === 2) { await win.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click()); await sleep(800); }
    await audit(win, `10-compare-${modes[i]}`);
  }
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[0].click()); await sleep(800);
  await win.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await sleep(300); await audit(win, '11-insp-menu');
  await clickText(win, '.pop .menu-item', '存为往来稿'); await win.waitForSelector('.ver-chip', { timeout: 10000 }).catch(() => {}); await sleep(900);
  await win.evaluate(() => document.querySelector('.ver-chip')?.click()); await sleep(400); await audit(win, '12-thread-pop');
  await win.keyboard.press('Escape'); await sleep(300);
  await win.evaluate(() => [...document.querySelectorAll('button')].find((b) => /导出/.test(b.title || b.textContent))?.click()); await sleep(500); await audit(win, '13-export');
  await win.keyboard.press('Escape'); await sleep(300);
  await win.evaluate(() => document.querySelector('.filechip')?.click()); await sleep(300); await audit(win, '14-filechip-menu');
  await win.keyboard.press('Escape');
  await win.evaluate(() => document.querySelector('.tb-set, button[aria-label="比较设置"]')?.click()); await sleep(300); await audit(win, '15-compare-settings');
  await app.close();

  ({ app, win } = await launch([PA, PB]));
  await sleep(4000);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click()); await sleep(3000);
  await win.evaluate(() => [...document.querySelectorAll('.seg button')].find((b) => /淡化/.test(b.textContent))?.click()); await sleep(800);
  await audit(win, '16-image-fade');
  await app.close();
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(all, null, 1));
  console.log('elements', all.length);
})().catch((e) => { console.error(e); process.exit(1); });
