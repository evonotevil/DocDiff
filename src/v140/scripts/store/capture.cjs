// 为商店图截取真实界面（2x 分辨率）
const { _electron } = require('playwright');
const OUT = '/home/claude/store/raw';
require('fs').mkdirSync(OUT, { recursive: true });
const E = '/home/claude/docdiff/node_modules/electron/dist/electron';
const S = '/home/claude/samples';

async function open(a, b, theme = 'light') {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--force-device-scale-factor=2', '/home/claude/docdiff', a, b] });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 2880, height: 1800 });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(2));
  await win.waitForTimeout(2600);
  const cur = await win.evaluate(() => document.documentElement.dataset.theme);
  if (cur !== theme) {
    await win.evaluate(() => { const b = [...document.querySelectorAll('.nav-item')].find((b) => /深色|浅色/.test(b.textContent)); b && b.click(); });
    await win.waitForTimeout(500);
  }
  return { app, win };
}
const tab = (win, i) => win.evaluate((i) => document.querySelectorAll('.nav-item')[i].click(), i);

(async () => {
  // 1. 富文本并排（选中一处修改）
  let { app, win } = await open(`${S}/合同_v1.docx`, `${S}/合同_v2.docx`);
  await win.evaluate(() => document.querySelectorAll('.chg')[3].click());
  await win.waitForTimeout(1500);
  await win.mouse.move(5, 5);
  await win.screenshot({ path: `${OUT}/1-rich.png` });

  // 3. 修订审阅（处理到一半）
  await tab(win, 2); await win.waitForTimeout(1200);
  for (let i = 0; i < 6; i++) { await win.keyboard.press(i === 2 ? 'r' : 'a'); await win.waitForTimeout(900); }
  await win.waitForTimeout(700);
  await win.screenshot({ path: `${OUT}/3-review.png` });

  // 4. 图像比对
  await tab(win, 3); await win.waitForTimeout(8500);
  await win.screenshot({ path: `${OUT}/4-image.png` });
  await app.close();

  // 2. PDF 与 Word 互比 + 点击对齐
  ({ app, win } = await open(`${S}/split_A.pdf`, `${S}/split_B.docx`));
  const pos = await win.evaluate(() => {
    const c = [...document.querySelectorAll('.cell[data-side="a"]')].find((c) => c.textContent.includes('following terms'));
    const s = [...c.querySelectorAll('[data-mi]')].find((x) => x.textContent === 'successor');
    const r = s.getBoundingClientRect(); return { x: r.left + 3, y: r.top + r.height / 2, w: innerWidth };
  });
  const k = 1;
  await win.mouse.move(pos.x * k, pos.y * k); await win.waitForTimeout(300);
  await win.mouse.click(pos.x * k, pos.y * k); await win.waitForTimeout(800);
  await win.screenshot({ path: `${OUT}/2-align.png` });
  await app.close();

  // 5. 深色模式
  ({ app, win } = await open(`${S}/合同_v1.docx`, `${S}/合同_v2.pdf`, 'dark'));
  await win.evaluate(() => document.querySelectorAll('.chg')[5]?.click());
  await win.waitForTimeout(1500);
  await win.mouse.move(5, 5);
  await win.screenshot({ path: `${OUT}/5-dark.png` });
  // 恢复浅色，避免影响下次启动
  await win.evaluate(() => { const b = [...document.querySelectorAll('.nav-item')].find((b) => /深色|浅色/.test(b.textContent)); b && b.click(); });
  await app.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
