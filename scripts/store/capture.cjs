// v1.4 商店图素材：2x 真实界面截图 + 吉祥物 SVG
const fs = require('fs');
const { _electron } = require('playwright');
const OUT = '/home/claude/store/raw14'; fs.mkdirSync(OUT, { recursive: true });
const E = '/home/claude/docdiff/node_modules/electron/dist/electron';
const S = '/home/claude/samples', S2 = '/home/claude/samples_store';

async function open(a, b, { theme = 'light', lang = 'zh', w = 2880, h = 1800, plat } = {}) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '/home/claude/docdiff', a, b] });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: w, height: h });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await win.waitForSelector('.edge-handle.left', { timeout: 60000 });
  await win.waitForTimeout(1500);
  if ((await win.evaluate(() => document.documentElement.dataset.lang)) !== lang) {
    await win.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => /设置|Settings/.test(b.textContent)).click());
    await win.waitForTimeout(600);
    await win.evaluate((l) => [...document.querySelectorAll('.seg button')].find((x) => x.textContent === (l === 'en' ? 'English' : '中文')).click(), lang);
    await win.waitForTimeout(500);
    await win.evaluate(() => [...document.querySelectorAll('.modal .acts button')].pop().click());
    await win.waitForTimeout(500);
  }
  const cur = await win.evaluate(() => document.documentElement.dataset.theme);
  if (cur !== theme) {
    await win.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => /深色模式|浅色模式|Dark mode|Light mode/.test(b.textContent)).click());
    await win.waitForTimeout(700);
  }
  // 恢复展开状态（上一次运行可能折叠了）
  if (await win.$('.shell.nav-mini')) { await win.evaluate(() => document.querySelector('.edge-handle.left').click()); await win.waitForTimeout(400); }
  if (await win.$('.shell.aside-off')) { await win.evaluate(() => document.querySelector('.edge-handle.right').click()); await win.waitForTimeout(400); }
  if (plat) await win.evaluate((p) => { document.documentElement.dataset.platform = p; }, plat);
  await win.waitForTimeout(1800);
  return { app, win };
}
const tab = (win, i) => win.evaluate((i) => document.querySelectorAll('.nav-item')[i].click(), i);

(async () => {
  // 1. 富文本（中文，选中一处）
  let { app, win } = await open(`${S}/合同_v1.docx`, `${S}/合同_v2.docx`);
  await win.evaluate(() => document.querySelectorAll('.chg')[3].click());
  await win.waitForTimeout(1200); await win.mouse.move(5, 5);
  await win.screenshot({ path: `${OUT}/1-rich.png` });
  // 吉祥物 SVG（各种表情）
  const moods = await win.evaluate(() => {
    const out = {};
    const el = document.querySelector('.hero svg, .mascot svg, svg');
    return out;
  });
  // 3. 修订审阅（处理到一半）
  await tab(win, 2); await win.waitForTimeout(1200);
  for (let i = 0; i < 6; i++) { await win.keyboard.press(i === 2 ? 'r' : 'a'); await win.waitForTimeout(800); }
  await win.waitForTimeout(600);
  await win.screenshot({ path: `${OUT}/3-review.png` });
  // 3b. 审阅完成页
  if (await win.$('.shell.aside-off')) { await win.evaluate(() => document.querySelector('.edge-handle.right').click()); await win.waitForTimeout(600); }
  await win.evaluate(() => { const b = [...document.querySelectorAll('button')].find((b) => /全部接受|Accept all/.test(b.textContent)); if (b) b.click(); });
  await win.waitForTimeout(1800);
  await win.screenshot({ path: `${OUT}/3b-done.png` });
  // 4. 图像比对
  await win.evaluate(() => { const b = [...document.querySelectorAll('.done-acts button')].pop(); b && b.click(); });
  await win.waitForTimeout(500);
  await tab(win, 3); await win.waitForTimeout(9000);
  await win.screenshot({ path: `${OUT}/4-image.png` });
  await app.close();

  // 2. PDF 与 Word 互比 + 点击对齐
  ({ app, win } = await open(`${S2}/split_A.pdf`, `${S2}/split_B.docx`));
  const pos = await win.evaluate(() => {
    const c = [...document.querySelectorAll('.cell[data-side="a"]')].find((c) => c.textContent.includes('following terms'));
    const s = [...c.querySelectorAll('[data-mi]')].find((x) => x.textContent === 'successor');
    const r = s.getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2 };
  });
  await win.mouse.move(pos.x, pos.y); await win.waitForTimeout(300);
  await win.mouse.click(pos.x, pos.y); await win.waitForTimeout(900);
  await win.screenshot({ path: `${OUT}/2-align.png` });
  await app.close();

  // 5. 深色模式（中文）
  ({ app, win } = await open(`${S}/合同_v1.docx`, `${S}/合同_v2.pdf`, { theme: 'dark' }));
  await win.evaluate(() => document.querySelectorAll('.chg')[5]?.click());
  await win.waitForTimeout(1200); await win.mouse.move(5, 5);
  await win.screenshot({ path: `${OUT}/5-dark.png` });
  await app.close();

  // 6. 英文界面（Windows 外观）+ 侧栏折叠
  ({ app, win } = await open(`${S}/合同_v1.docx`, `${S}/合同_v2.docx`, { lang: 'en', plat: 'win' }));
  await win.evaluate(() => document.querySelectorAll('.chg')[2]?.click());
  await win.waitForTimeout(1000); await win.mouse.move(5, 5);
  await win.screenshot({ path: `${OUT}/6-en-win.png` });
  // 6b. 折叠两侧
  await win.evaluate(() => { document.querySelector('.edge-handle.left').click(); });
  await win.waitForTimeout(400);
  await win.evaluate(() => { document.querySelector('.edge-handle.right').click(); });
  await win.waitForTimeout(900);
  await win.screenshot({ path: `${OUT}/7-collapsed.png` });
  // 设置弹窗
  await win.evaluate(() => [...document.querySelectorAll('.nav-item')].find((b) => /Settings/.test(b.textContent)).click());
  await win.waitForTimeout(700);
  await win.screenshot({ path: `${OUT}/8-settings.png` });
  // 吉祥物 SVG
  await win.evaluate(() => [...document.querySelectorAll('.modal .acts button')].pop().click());
  await win.waitForTimeout(400);
  const mascots = await win.evaluate(() => {
    const R = (window).__mascot; return null;
  });
  await app.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
