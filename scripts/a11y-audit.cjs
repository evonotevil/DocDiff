// 无障碍与适配复查（1.8.1）：axe 扫首页（第一次用 / 老用户英文）、比较页、设置、导出；量宽屏、长文件名、英文提示、阿拉伯文方向、语言切换。
// 用法：xvfb-run -a node scripts/a11y-audit.cjs   （只用合成夹具；字标和绿 / 蓝实心按钮是规范里的品牌例外，axe 会照报）
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require('/opt/npm-tools/node_modules/playwright');
const R = path.join(__dirname, '..');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'au-'));
const F = (n) => path.join(dir, `合作协议-${n}.docx`);
for (const n of ['V1', 'V2']) fs.copyFileSync(path.join(R, 'work/review-fixtures', `neg-${n}.docx`), F(n));
const longName = path.join(dir, '甲'.repeat(80) + '.docx'); fs.copyFileSync(F('V2'), longName);
const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'auc-'));
const out = {};
const axe = async (w, tag) => { await w.evaluate(AXE); const r = await w.evaluate(async () => { const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice'] }); return r.violations.map((v) => `${v.id}[${v.impact}]x${v.nodes.length}: ` + v.nodes.slice(0,3).map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message || '').slice(0, 90)).join(' | ')); }); out['axe:' + tag] = r; };
const launch = async (args, size = [1440, 900]) => { const app = await _electron.launch({ executablePath: path.join(R, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', '--lang=zh-CN', R, ...args], env: { ...process.env, XDG_CONFIG_HOME: cfg } }); const w = await app.firstWindow(); await w.setViewportSize({ width: size[0], height: size[1] }); return { app, w }; };
(async () => {
  let { app, w } = await launch([]); await w.waitForSelector('.drops'); await axe(w, 'home-first'); await app.close();
  ({ app, w } = await launch([F('V1'), F('V2')])); await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 });
  await axe(w, 'compare-rich');
  // 设置、导出弹窗
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(400); await axe(w, 'settings'); await w.keyboard.press('Escape'); await w.waitForTimeout(300);
  await w.evaluate(() => document.querySelector('.tb-export')?.click()); await w.waitForTimeout(400); await axe(w, 'export');
  out.closeBtn = await w.evaluate(() => { const b = document.querySelector('.modal [aria-label="关闭"], .modal .icon-btn, .modal-head button'); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), b.className]; });
  await w.keyboard.press('Escape'); await w.waitForTimeout(300);
  out.switchSm = await w.evaluate(() => { const s = document.querySelector('.switch.sm'); if (!s) return null; const r = s.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  // 深色模式
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find((b) => /深色/.test(b.textContent))?.click()); await w.waitForTimeout(300); await w.keyboard.press('Escape'); await w.waitForTimeout(500);
  await axe(w, 'compare-dark');
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find((b) => /浅色/.test(b.textContent))?.click()); await w.waitForTimeout(300); await w.keyboard.press('Escape'); await w.waitForTimeout(400);
  // 宽屏
  for (const W of [1440, 1920, 2560]) { await w.setViewportSize({ width: W, height: 1000 }); await w.waitForTimeout(400); out['rich@' + W] = await w.evaluate(() => { const r = document.querySelector('.rich'); const c = r?.querySelector('.cell'); return r ? [Math.round(r.getBoundingClientRect().width), c ? Math.round(c.getBoundingClientRect().width) : 0] : null; }); }
  await w.setViewportSize({ width: 1440, height: 900 }); await w.waitForTimeout(300);
  // 语言切换
  const secBefore = await w.evaluate(() => [...document.querySelectorAll('.sec-head, .sh, .grp')].slice(0, 4).map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 40)));
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')].find((b) => /设置/.test(b.textContent))?.click()); await w.waitForTimeout(300);
  await w.evaluate(() => [...document.querySelectorAll('.modal .seg button')].find((b) => /English/.test(b.textContent))?.click()); await w.waitForTimeout(300); await w.keyboard.press('Escape'); await w.waitForTimeout(600);
  out.langSwitch = { before: secBefore, after: await w.evaluate(() => [...document.querySelectorAll('.sec-head, .sh, .grp')].slice(0, 4).map((x) => x.innerText.replace(/\s+/g, ' ').slice(0, 40))), cjkLeft: await w.evaluate(() => [...document.querySelectorAll('.main .sec-head, .insp .grp, .insp .sh, .canvas-head, .ch-title')].map((x) => x.innerText).filter((s) => /[一-鿿]/.test(s)).slice(0, 6)) };
  // 英文首页 compact + 长文件名
  await w.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await w.waitForSelector('.drops'); await w.waitForTimeout(500);
  await axe(w, 'home-veteran-en');
  out.enCompact = await w.evaluate(() => [...document.querySelectorAll('.drop.compact .title')].map((t) => ({ text: t.textContent, clipped: t.scrollWidth > t.clientWidth + 1 })));
  await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, longName);
  await w.evaluate(() => [...document.querySelectorAll('.drop.compact')][1].querySelector('.btn')?.click()); await w.waitForTimeout(2500);
  out.longName = await w.evaluate(() => { const d = [...document.querySelectorAll('.drop.compact')].map((x) => Math.round(x.getBoundingClientRect().width)); const lc = [...document.querySelectorAll('.lib-cols > *')].map((x) => Math.round(x.getBoundingClientRect().width)); return { drops: d, cards: lc, pageScroll: document.documentElement.scrollWidth - innerWidth, title: !!document.querySelector('.drop.compact .title.file [title], .drop.compact .title.file .mid-name[title]') }; });
  await app.close();
  // RTL：粘贴阿拉伯文
  ({ app, w } = await launch([]));
  await w.waitForSelector('.drops');
  const paste = async (i, txt) => { await w.evaluate((i) => [...document.querySelectorAll('.drop')][i].querySelectorAll('.btn')[1].click(), i); await w.waitForSelector('.modal textarea'); await w.fill('.modal textarea', txt); await w.evaluate(() => [...document.querySelectorAll('.modal .btn')].find((b) => /使用这段文字|Use/.test(b.textContent)).click()); await w.waitForTimeout(500); };
  await paste(0, 'المادة (1): يدفع الطرف الأول مبلغ 100 دولار عبر PayPal خلال 30 يوما.\nالمادة 2: السرية.');
  await paste(1, 'المادة (1): يدفع الطرف الأول مبلغ 150 دولار عبر PayPal خلال 45 يوما.\nالمادة 2: السرية التامة.');
  await w.evaluate(() => [...document.querySelectorAll('.home-cta .btn')].find((b) => !b.disabled)?.click());
  await w.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 60000 }).catch(() => {}); await w.waitForTimeout(800);
  out.rtl = await w.evaluate(() => { const p = document.querySelector('.rich .blk'); if (!p) return null; const cs = getComputedStyle(p); return { dir: cs.direction, align: cs.textAlign, dirAttr: p.closest('[dir]')?.getAttribute('dir') || null }; });
  await app.close();
  const bad = Object.entries(out).filter(([k, v]) => k.startsWith('axe:')).flatMap(([k, v]) => v.filter((x) => !/^color-contrast/.test(x) || !/wm-text|tb-export|primary\.btn|\.primary/.test(x)).map((x) => k + ' ' + x));
  const checks = { axe: bad.length === 0, wide: out['rich@2560'][1] <= 860, longName: out.longName.drops[0] === out.longName.drops[1] && out.longName.pageScroll === 0, enPrompt: out.enCompact.every((x) => !x.clipped), rtl: out.rtl?.dir === 'rtl' };
  console.log(JSON.stringify({ ...out, checks, bad }, null, 1));
  process.exit(Object.values(checks).every(Boolean) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
