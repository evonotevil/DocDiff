// 纯文本视图按需挂载的正确性（beta.7）：跳到最后一处、全选复制完整、隐藏未变化时折叠展开。
// 用法：xvfb-run -a node scripts/e2e-plain-window.cjs <A> <B>
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const [A, B] = process.argv.slice(2);
(async () => {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'pw-')) } });
  const win = await app.firstWindow();
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[1].click());
  await win.waitForSelector('.code .crow');
  const total = await win.evaluate(() => +((document.querySelector('.tb-pos')?.textContent || '').match(/\/\s*(\d+)/) || [])[1] || 0);
  // 按 K 从第一处倒回最后一处
  await win.evaluate(() => document.querySelector('.code').click());
  await win.keyboard.press('j'); await win.keyboard.press('k'); await win.keyboard.press('k');
  await win.waitForTimeout(700);
  const vis = await win.evaluate(() => { const el = document.querySelector('.code .sel-cid'); if (!el) return null; const r = el.getBoundingClientRect(); const sc = document.querySelector('.main .scroll').getBoundingClientRect(); return { inView: r.top >= sc.top - 2 && r.bottom <= sc.bottom + 2, top: r.top }; });
  assert.ok(vis && vis.inView, 'last change is mounted and scrolled into view: ' + JSON.stringify(vis));
  // 全选：整篇都要挂上
  await win.evaluate(() => { const c = document.querySelector('.code'); const r = document.createRange(); r.selectNodeContents(c); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
  await win.waitForTimeout(300);
  const len = await win.evaluate(() => getSelection().toString().split('\n').filter((x) => x.trim()).length);
  const ph = await win.evaluate(() => document.querySelectorAll('.code .cchunk.ph').length);
  assert.equal(ph, 0, 'select-all mounts every chunk');
  assert.ok(len > 2900, 'selected text covers the whole document: ' + len);
  await win.evaluate(() => getSelection().removeAllRanges());
  await win.waitForTimeout(300);
  const ph2 = await win.evaluate(() => document.querySelectorAll('.code .cchunk.ph').length);
  assert.ok(ph2 > 0, 'chunks unmount again after the selection is cleared');
  console.log(JSON.stringify({ ok: true, total, selectedLines: len, placeholdersAfter: ph2 }));
  await app.close();
})().catch((e) => { console.error(e); process.exit(1); });
