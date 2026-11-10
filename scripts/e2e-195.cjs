// 1.9.5 端到端检查（只用合成夹具 scripts/make-comments-195.py，文件名一律 Document A / B）：
//   H1 纸面批注标和点线、H2 检查器「批注 N」分组、H3 审阅栏提示 + 回复、H4 我方成员 / 作者归属、
//   H5 内部批注不带入、写进审阅稿的回复线程、H6 定稿前写明去掉几条。
// 用法：python3 scripts/make-comments-195.py && xvfb-run -a node scripts/e2e-195.cjs [截图目录]
const path = require('path'), fs = require('fs'), os = require('os');
const JSZip = require('jszip');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(__dirname, '../work/shots-195');
fs.mkdirSync(OUT, { recursive: true });
const FIX = path.join(__dirname, '../work/comments-195');
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info !== undefined ? ' ' + JSON.stringify(info).slice(0, 400) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newCfg = (prefs = {}) => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-195-'));
  fs.mkdirSync(path.join(cfg, 'DocDiff'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'DocDiff', 'settings.json'), JSON.stringify({ lang: 'zh', 'prefs-v2': { sound: false, reviewerName: '测试审阅人', reviewerInitials: 'CS', reviewerAsked: true, mascotWalk: false, ...prefs } }));
  return cfg;
};
async function launch(cfg, files = []) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, ...files], env: { ...process.env, XDG_CONFIG_HOME: cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  return { app, win, errs };
}
const shot = (win, n) => win.screenshot({ path: path.join(OUT, n + '.png') });
const clickText = (win, s, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [s, re]);
const readCm = async (p) => {
  const z = await JSZip.loadAsync(fs.readFileSync(p));
  const c = await z.file('word/comments.xml')?.async('string') || '';
  const ex = await z.file('word/commentsExtended.xml')?.async('string') || '';
  const doc = await z.file('word/document.xml').async('string');
  return { c, ex, doc };
};

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-195f-'));
  const F = (n) => path.join(dir, `Document ${n}.docx`);
  fs.copyFileSync(path.join(FIX, 'cm-A.docx'), F('A')); fs.copyFileSync(path.join(FIX, 'cm-B.docx'), F('B'));
  const cfg = newCfg({ ourMembers: ['王同事（示例）', '赵经理（示例）'] });
  let { app, win, errs } = await launch(cfg, [F('A'), F('B')]);
  await win.waitForFunction(() => document.querySelectorAll('.dlist .drow').length > 0, null, { timeout: 60000 }); await sleep(800);

  // ---------- H1 富文本：批注标和点线 ----------
  const rich = await win.evaluate(() => ({
    pinsA: [...document.querySelectorAll('.cell[data-side="a"] .cm-pin')].map((x) => x.dataset.cmk),
    pinsB: [...document.querySelectorAll('.cell[data-side="b"] .cm-pin')].map((x) => x.dataset.cmk),
    marks: [...document.querySelectorAll('.cm-mark')].map((x) => x.textContent),
    theirs: document.querySelectorAll('.cm-pin.theirs').length,
  }));
  ok('rich: our-draft comments pinned on the left paper', rich.pinsA.includes('a:1') && rich.pinsA.includes('a:2'), rich.pinsA);
  ok('rich: their-draft comments pinned on the right paper (one pin per paragraph)', ['b:10', 'b:15', 'b:16', 'b:18', 'b:19', 'b:20'].every((k) => rich.pinsB.some((x) => x.split(' ').includes(k))), rich.pinsB);
  ok('rich: commented text gets the dotted mark (incl. table cell)', ['十五日内', '保密义务', '负有保密义务', '十二万元', '违约金上限'].every((w) => rich.marks.join('').includes(w)), rich.marks);
  const markStyle = await win.evaluate(() => { const s = getComputedStyle(document.querySelector('.cm-mark')); return { b: s.borderBottomWidth, st: s.borderBottomStyle }; });
  ok('rich: mark is a 2px dotted line', markStyle.b === '2px' && markStyle.st === 'dotted', markStyle);
  await shot(win, '01-rich');

  // ---------- H2 检查器：「批注 N」 ----------
  const chip = await win.evaluate(() => document.querySelector('.fchip.cm')?.textContent);
  ok('inspector: 批注 chip counts open threads (theirs unresolved + ours) = 8', /批注\s*8/.test(chip || ''), chip);
  await win.evaluate(() => document.querySelector('.fchip.cm').click()); await sleep(400);
  const groups = await win.evaluate(() => [...document.querySelectorAll('.cm-list .grp, .cm-list .cm-fold span')].map((x) => x.textContent));
  ok('inspector: groups in order (changed → theirs → resolved folded → ours → plain)', JSON.stringify(groups) === JSON.stringify(['同事批过、被对方改了', '对方批注', '对方已解决 1 条', '我方批注', '没有修订的地方']), groups);
  const firstTheirs = await win.evaluate(() => [...document.querySelectorAll('.cm-list .dgroup')][1].querySelector('.cm-st').textContent);
  ok('inspector: rows show clause · state', /第三条.*未回复|第九条.*已删/.test(firstTheirs), firstTheirs);
  await win.evaluate(() => document.querySelector('.cm-row[data-cm-row="b:20"]').click()); await sleep(900);
  const card1 = await win.evaluate(() => ({ open: !!document.querySelector('.cm-pop .cm-card[data-cm-card="b:20"]'), where: document.querySelector('.cm-pop .cm-where')?.textContent, pinOpen: !!document.querySelector('.cm-pin.open') }));
  ok('inspector: clicking a plain comment scrolls the paper and opens its card at the pin', card1.open && /第十二条/.test(card1.where || '') && card1.pinOpen, card1);
  const when = await win.evaluate(() => document.querySelector('.cm-pop .cm-time')?.textContent);
  ok('card time = the wall-clock time Word shows (w:date is local time)', when === '11月8日 14:20', when);
  await shot(win, '02-inspector-card');
  await win.keyboard.press('Escape'); await sleep(200);

  // ---------- H3 修订审阅：审阅栏提示 + 回复 ----------
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(1200);
  await win.evaluate(() => [...document.querySelectorAll('.fchip')][0].click()); await sleep(300);
  await win.evaluate(() => document.querySelector('.dlist .drow').click()); await sleep(500);
  const hint = await win.evaluate(() => document.querySelector('.rb-cm')?.textContent);
  ok('review bar: hint for the comment on this change', /对方批注：付款周期/.test(hint || ''), hint);
  const redPins = await win.evaluate(() => [...document.querySelectorAll('.redline .cm-pin')].map((x) => x.dataset.cmk));
  ok('redline: one pin per paragraph, our-draft comments drawn on the revised text', redPins.some((x) => x.includes('a:1')) && redPins.some((x) => x.includes('a:2')), redPins);
  await clickText(win, '.rb-cm .link-btn', '^回复$'); await sleep(500);
  const inp = await win.evaluate(() => !!document.querySelector('.cm-pop .cm-item.editing input'));
  ok('review bar: 回复 opens the card with the reply box focused', inp && await win.evaluate(() => document.activeElement?.closest('.cm-item.editing') != null));
  await win.keyboard.type('同意改为十五日。'); await win.keyboard.press('Enter'); await sleep(400);
  const mine = await win.evaluate(() => document.querySelector('.cm-pop .cm-item.mine .cm-text')?.textContent);
  ok('card: saved reply shows as 你的回复', mine === '同意改为十五日。', mine);
  await shot(win, '03-redline-reply');
  await win.keyboard.press('Escape'); await sleep(200);

  // ---------- H4 作者归属：改成我方 ----------
  await win.evaluate(() => document.querySelector('.redline .cm-pin[data-cmk~="b:19"]').click()); await sleep(400);
  await clickText(win, '.cm-pop .link-btn', '作者归属'); await sleep(300);
  const menu = await win.evaluate(() => [...document.querySelectorAll('.pop-menu .menu-item')].map((x) => x.textContent));
  ok('card: author menu offers theirs / ours / add to our team', menu.length === 3 && /加进我方成员/.test(menu[2]), menu);
  await win.keyboard.press('Escape'); await sleep(150); await win.keyboard.press('Escape'); await sleep(200);

  // ---------- 生成审阅稿 → H5 内部批注 → 不带入 ----------
  await win.evaluate(() => document.querySelector('.tbar [aria-label="生成审阅稿"]')?.click());
  const draft = path.join(dir, 'Document B-我方意见.docx');
  for (let i = 0; i < 40 && !fs.existsSync(draft); i++) await sleep(250);
  await sleep(800);
  ok('draft: created', fs.existsSync(draft));
  let x = await readCm(draft);
  ok('draft: reply written as a Word reply (commentsExtended paraIdParent → comment 10)', /同意改为十五日/.test(x.c) && /paraIdParent="2000B010"/.test(x.ex), x.ex.slice(0, 300));
  const warn = await win.evaluate(() => document.querySelector('.nt.cm-int b')?.textContent);
  ok('canvas: internal comments warning after the redline exists', /审阅稿里有 2 条我方内部批注/.test(warn || ''), warn);
  await shot(win, '04-internal-warning');
  await clickText(win, '.nt.cm-int .btn', '不带入'); await sleep(400);
  const modal = await win.evaluate(() => ({ n: document.querySelectorAll('.modal .cm-drop-list .cbx.on').length, ok: document.querySelector('.modal-foot .btn.blue, .modal .btn.blue')?.textContent }));
  ok('modal: lists both internal comments, all checked', modal.n === 2 && /不带入这 2 条/.test(modal.ok || ''), modal);
  await shot(win, '05-drop-modal');
  await clickText(win, '.modal .btn.blue', '不带入'); await sleep(1500);
  x = await readCm(draft);
  ok('draft: internal comments and their markers removed', !/这里先别松口/.test(x.c) && !/内部先确认一下/.test(x.c) && !/w:id="18"/.test(x.doc) && !/commentReference w:id="11"/.test(x.doc), { c: x.c.length });
  ok('draft: other comments kept', /付款周期能否改为/.test(x.c) && /首付款调整/.test(x.c));
  ok('canvas: warning gone after leaving them out', !(await win.evaluate(() => !!document.querySelector('.nt.cm-int'))));

  // ---------- H6 定稿：写明去掉几条 ----------
  await win.evaluate(() => document.querySelector('.tbar [aria-label="更多操作"], .sh [aria-label="更多操作"]')?.click()); await sleep(300);
  await clickText(win, '.pop-menu .menu-item', '生成定稿'); await sleep(500);
  const fin = await win.evaluate(() => [...document.querySelectorAll('.final-dlg .nt b')].map((x) => x.textContent));
  ok('final dialog: says how many comments the clean copy drops', fin.some((x) => /定稿会去掉全部 \d+ 条批注（对方 \d+、我方 \d+）/.test(x)), fin);
  await shot(win, '06-final');
  await win.keyboard.press('Escape'); await sleep(200);

  // ---------- H4 设置 · 我方成员 ----------
  await win.evaluate(() => document.querySelector('.nav-foot .nav-item:last-child')?.click()); await sleep(300);
  await win.evaluate(() => [...document.querySelectorAll('.set-tabs [role=tab]')].find((b) => /审阅/.test(b.textContent))?.click()); await sleep(300);
  const mem = await win.evaluate(() => ({ kws: [...document.querySelectorAll('#rv-s3 ~ .kw-editor .kw')].map((x) => x.textContent), sugg: [...document.querySelectorAll('#rv-s3 ~ .kw-editor .set-hint .link-btn')].map((x) => x.textContent) }));
  ok('settings: 我方成员 lists reviewer first + members, suggests authors from the files', /测试审阅人（审阅人）/.test(mem.kws[0] || '') && mem.kws.length === 3 && mem.sugg.includes('李律师（示例）'), mem);
  await win.evaluate(() => document.querySelector('#rv-s3')?.scrollIntoView()); await sleep(200);
  await shot(win, '07-settings-members');
  await win.keyboard.press('Escape'); await sleep(200);

  ok('no page errors', errs.length === 0, errs);
  await app.close();

  // ---------- 1.9.5.1：两份文字完全一样、只有批注：修订审阅照常显示纸面 ----------
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-195g-'));
  const G = (n) => path.join(dir2, `Document ${n}.docx`);
  fs.copyFileSync(path.join(FIX, 'cm-plain-B.docx'), G('A')); fs.copyFileSync(path.join(FIX, 'cm-B.docx'), G('B'));
  ({ app, win, errs } = await launch(newCfg(), [G('A'), G('B')]));
  await win.waitForFunction(() => document.querySelector('.fchip.cm'), null, { timeout: 60000 }); await sleep(600);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(1000);
  const only = await win.evaluate(() => ({ paper: !!document.querySelector('.redline'), pins: document.querySelectorAll('.redline .cm-pin').length, note: document.querySelector('.nt.cm-only b')?.textContent, empty: !!document.querySelector('.main .empty-state'), bar: !!document.querySelector('.review-bar') }));
  ok('no changes, only comments: redline paper shown with pins and a one-line notice; no review bar', only.paper && only.pins >= 6 && /文字一样，只有 \d+ 条批注/.test(only.note || '') && !only.empty && !only.bar, only);
  await win.evaluate(() => document.querySelector('.fchip.cm').click()); await sleep(300);
  await win.evaluate(() => document.querySelector('.cm-row[data-cm-row="b:20"]').click()); await sleep(900);
  const at = await win.evaluate(() => { const p = document.querySelector('.cm-pin.open'); const r = p?.getBoundingClientRect(); return { open: !!document.querySelector('.cm-pop .cm-card[data-cm-card="b:20"]'), pin: !!p, visible: !!r && r.top > 0 && r.bottom < innerHeight }; });
  ok('no changes: clicking a comment scrolls the paper to its pin and opens the card there', at.open && at.pin && at.visible, at);
  await shot(win, '08-comments-only');
  ok('no page errors (comments only)', errs.length === 0, errs);
  await app.close();

  // ---------- 1.9.5 补：整段新增 / 删除按决定去掉后，批注标还在；拒绝后换回来的原文也有点线；卡片写出被批注的文字 ----------
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-195h-'));
  const H = (n) => path.join(dir3, `Document ${n}.docx`);
  fs.copyFileSync(path.join(FIX, 'cm2-A.docx'), H('A')); fs.copyFileSync(path.join(FIX, 'cm2-B.docx'), H('B'));
  ({ app, win, errs } = await launch(newCfg({ ourMembers: ['王同事（示例）'] }), [H('A'), H('B')]));
  await win.waitForFunction(() => document.querySelectorAll('.dlist .drow').length > 0, null, { timeout: 60000 }); await sleep(500);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(900);
  const n0 = await win.evaluate(() => document.querySelectorAll('.redline .cm-pin').length);
  // 删除的那段：接受（段落消失）；新增的那段：拒绝（段落消失）
  const drows = await win.evaluate(() => [...document.querySelectorAll('.dlist .drow')].map((x) => x.className));
  for (let i = 0; i < drows.length; i++) {
    const k = await win.evaluate((i) => document.querySelectorAll('.dlist .drow')[i].className, i);
    await win.evaluate((i) => document.querySelectorAll('.dlist .drow')[i].click(), i); await sleep(200);
    await win.keyboard.press(/k-del/.test(k) ? 'a' : 'r'); await sleep(300);
  }
  await sleep(500);
  await win.evaluate(() => [...document.querySelectorAll('.done-card .btn')].find((b) => /回去再看看/.test(b.textContent))?.click()); await sleep(300);
  const gone = await win.evaluate(() => ({ pins: document.querySelectorAll('.redline .cm-pin').length, ghost: [...document.querySelectorAll('.redline .cm-ghost')].map((x) => x.textContent) }));
  ok('paragraphs removed by decisions keep their pins with a one-line note', n0 === 2 && gone.pins === 2 && gone.ghost.length === 2 && /按你的决定已去掉/.test(gone.ghost[0]), { n0, gone });
  await win.evaluate(() => document.querySelector('.redline .cm-pin').click()); await sleep(400);
  const q = await win.evaluate(() => document.querySelector('.cm-pop .cm-quote .q')?.textContent);
  ok('card shows the commented text', /本合同有效期一年|双方确认已阅读全部条款/.test(q || ''), q);
  await shot(win, '09-gone-paragraphs');
  await app.close();

  // 拒绝 “三十 → 十五” 后，换回来的“三十”也有点线（对方批注挂在“十五日内”上）
  const dir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-195i-'));
  const K = (n) => path.join(dir4, `Document ${n}.docx`);
  fs.copyFileSync(path.join(FIX, 'cm-A.docx'), K('A')); fs.copyFileSync(path.join(FIX, 'cm-B.docx'), K('B'));
  ({ app, win, errs } = await launch(newCfg(), [K('A'), K('B')]));
  await win.waitForFunction(() => document.querySelectorAll('.dlist .drow').length > 0, null, { timeout: 60000 }); await sleep(500);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(900);
  const delMark = await win.evaluate(() => [...document.querySelectorAll('.redline .r-del.cm-mark')].map((x) => x.textContent));
  ok('text deleted under a comment gets the dotted line too (zero-width comment on a deleted sentence)', delMark.some((x) => /乙方可单方解除合同/.test(x)) && delMark.some((x) => /三十/.test(x)), delMark);
  await win.evaluate(() => document.querySelector('.dlist .drow').click()); await sleep(200); await win.keyboard.press('r'); await sleep(500);
  const rej = await win.evaluate(() => [...document.querySelectorAll('.redline .cm-mark')].map((x) => x.textContent).join('|'));
  ok('after rejecting, the restored original text keeps the dotted line', /三十/.test(rej), rej);
  const rowQ = await win.evaluate(() => { document.querySelector('.fchip.cm').click(); return null; }); await sleep(300);
  const rq = await win.evaluate(() => [...document.querySelectorAll('.cm-list .cm-q')].map((x) => x.textContent));
  ok('inspector rows show the commented text', rq.includes('十五日内') && rq.some((x) => /乙方可单方解除合同/.test(x)), rq);
  const tip = await win.evaluate(() => [...document.querySelectorAll('.cm-row')].filter((x) => x.title).length);
  ok('inspector rows have no duplicate tooltip for short comments', tip === 0, tip);
  await shot(win, '10-inspector-quotes');
  ok('no page errors (extra cases)', errs.length === 0, errs);
  await app.close();
  console.log(fail ? `\n${fail} FAILED` : '\nall passed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
