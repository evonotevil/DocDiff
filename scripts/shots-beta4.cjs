// beta.4 界面截图 + 小检查（只用合成夹具）：xvfb-run -a node scripts/shots-beta4.cjs <输出目录>
const path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(R, 'work', 'shots4');
fs.mkdirSync(OUT, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-s4-'));
const F = (n) => path.join(dir, `供货框架协议-乙方第二轮修订意见-${n}.docx`);
for (const n of ['V1', 'V2', 'V3']) fs.copyFileSync(path.join(R, 'work/review-fixtures', `neg-${n}.docx`), F(n));
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-c4-'));
const checks = [];
const ok = (k, v, info) => { checks.push([k, !!v]); console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };
(async () => {
  const app = await _electron.launch({ executablePath: path.join(R, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--lang=zh-CN', R, F('V1'), F('V2')], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; });
  const w = await app.firstWindow(); const errs = []; w.on('pageerror', (e) => errs.push(e.message));
  const shot = async (n, sel) => { await w.waitForTimeout(350); if (sel) { const el = await w.$(sel); if (el) return el.screenshot({ path: path.join(OUT, n + '.png') }); } await w.screenshot({ path: path.join(OUT, n + '.png') }); };
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await w.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await w.waitForTimeout(500);
  await w.evaluate(() => { const i = document.querySelector('.reviewer-ask input'); if (i) { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '甲'); i.dispatchEvent(new Event('input', { bubbles: true })); } });
  await w.evaluate(() => [...document.querySelectorAll('.reviewer-ask .btn')].find((b) => /好的/.test(b.textContent))?.click());
  await w.evaluate(() => document.querySelector('.dlist .drow')?.click()); await w.keyboard.press('r');
  await w.waitForTimeout(1500);
  await w.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  const draft = fs.readdirSync(dir).find((f) => /我方意见/.test(f));
  const authors = () => { try { return cp.execSync(`unzip -p "${path.join(dir, draft)}" word/document.xml 2>/dev/null`).toString().match(/w:author="[^"]*"/g) || []; } catch { return []; } };
  const before = authors();
  // 设置 · 审阅：改名
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal button')].find((b) => /^\s*审阅\s*$/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.fill('#rv-name', '乙'); await w.waitForTimeout(200);
  await w.setViewportSize({ width: 1440, height: 1500 }); await shot('c2-settings', '.modal');
  // 删空审阅稿文件名
  const ed = (await w.$$('.name-ed'))[0]; const ins = await ed.$$('.name-txt'); await ins[ins.length - 1].click(); await w.keyboard.press('End');
  for (let i = 0; i < 12; i++) await w.keyboard.press('Backspace');
  const st = await w.evaluate(() => { const e = document.querySelectorAll('.name-ed')[0]; return { empty: e.querySelector('.name-box').classList.contains('empty'), tags: e.querySelectorAll('.name-tag').length, pv: e.querySelector('.pv').textContent, ins: !!e.querySelector('.name-ins') }; });
  ok('name box can be emptied, shows default placeholder, insert row while editing', st.empty && st.tags === 0 && /我方意见/.test(st.pv) && st.ins, st);
  await w.keyboard.type('X');
  await w.evaluate(() => [...document.querySelectorAll('.name-ed')[0].querySelectorAll('.name-ins .btn')].find((b) => /日期/.test(b.textContent)).click()); await w.waitForTimeout(100);
  await w.keyboard.type('-legal');
  const pv = await w.evaluate(() => document.querySelectorAll('.name-ed')[0].querySelector('.pv').textContent);
  ok('tags insert without forced dash', /^X\d{8}-legal\.docx$/.test(pv), { pv });
  await shot('c2-editing', '.modal');
  await w.evaluate(() => [...document.querySelectorAll('.name-ed')[0].querySelectorAll('.btn')].find((b) => /恢复默认/.test(b.textContent))?.click());
  await w.setViewportSize({ width: 1440, height: 900 });
  await w.keyboard.press('Escape'); await w.waitForTimeout(1800);
  const after = authors();
  ok('draft re-signed with new reviewer after rename', (() => { const old = before.filter((a) => !/虚构作者/.test(a)); return old.length && !old.some((a) => /"乙"/.test(a)) && after.some((a) => /"乙"/.test(a)) && !after.some((a) => old.includes(a)); })(), { before: [...new Set(before)], after: [...new Set(after)] });
  // 存为往来稿 → 版本弹出层、拖入
  await w.evaluate(() => document.querySelector('.insp .sh .ibtn, .sh .ibtn.act')?.click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop .menu-item')].find((b) => /存为往来稿/.test(b.textContent))?.click());
  await w.waitForSelector('.ver-chip', { timeout: 10000 });
  await w.evaluate(() => document.querySelector('.ver-chip').click()); await shot('c3-popover');
  await w.keyboard.press('Escape'); await w.waitForTimeout(200);
  await w.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.docx')); const c = document.querySelector('.ver-chip'); c.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt })); c.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); });
  await w.waitForTimeout(300);
  await w.evaluate(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'a.docx')); document.querySelector('.ver-pop')?.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); });
  ok('dragging a file over the version chip opens the popover as a drop zone', await w.evaluate(() => /松手加入为 V3/.test(document.querySelector('.ver-drop')?.textContent || '')));
  await shot('c3-drop');
  // 首页：删除往来稿 → 撤销提示
  await w.mouse.click(5, 450); await w.keyboard.press('Escape');
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click());
  await w.waitForSelector('.lib-row', { timeout: 15000 });
  await w.evaluate(() => document.querySelector('.lib-card .lib-row .btn.icon').click()); await w.waitForTimeout(200);
  await w.evaluate(() => [...document.querySelectorAll('.pop .menu-item')].find((b) => /删除往来稿/.test(b.textContent))?.click()); await w.waitForTimeout(400);
  const tb = await w.evaluate(() => { const t = document.querySelector('.toast.undo'); const r = t.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), text: t.innerText.replace(/\s+/g, ' ') }; });
  ok('undo toast is one line', tb.h <= 52 && tb.w <= 560, tb);
  await shot('c1-toast');
  await w.keyboard.press('u'); await w.waitForTimeout(400);
  ok('U on the home page undoes the deletion', /供货框架协议/.test(await w.evaluate(() => document.querySelector('.lib-card')?.innerText || '')));
  // 最近比较里属于往来稿的一对：按往来稿打开
  await w.evaluate(() => document.querySelector('.recent-row')?.click());
  await w.waitForSelector('.ver-chip', { timeout: 20000 }).catch(() => {});
  ok('a recent pair that belongs to a negotiation opens as that negotiation', !!(await w.$('.ver-chip')));
  ok('no renderer errors', errs.length === 0, errs.slice(0, 3));
  await app.close();
  process.exit(checks.every((c) => c[1]) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
