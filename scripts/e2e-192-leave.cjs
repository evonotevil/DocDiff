// 1.9.2：快速审阅后立即离开时的数据同步（P1 审阅稿漏写、P2 往来稿轮次摘要漏写）。
// 三版本往来稿（合成 3,000 段 Word，Document A / B / C），在 V1 → V2 生成审阅稿后快速按 R 40 次（间隔约 25ms，不等写盘），
// 然后立即离开：退出 / 新建比较 / 从版本链切到 V2 → V3；每条路径各卡三个时机：
//   t1 防抖还没执行（页面钩子把 0.25 秒的合并等待拉长到 5 秒，按完立刻离开）
//   t2 Worker 已生成、还没交给主进程（页面钩子 __ddDraftHooks.afterBuild 卡住，离开后再放行）
//   t3 主进程已收到保存、还没写完（主进程钩子 global.__ddSaveDelay 让改名前停 2.5 秒）
// 每次都核对：持久化的 40 个决定；旧审阅稿“接受全部修订”后的文字和审阅人修订数，与不离开时写出的参考稿完全一致（不只看修改时间）。
// 另外：Word 占用时写不进去的提示、退出时的提示、重启后的提示与补写；新版本另生成审阅稿不串写；
// 旧保存未完成时切回旧版本改一处，最终文件反映最新决定；不生成审阅稿时轮次摘要保留 40 条、重启后条款历史显示。
// 记录快速按键期间和离开操作的主线程长任务、离开操作的等待时间。
// 用法：python3 scripts/make-perf-review-3000.py && xvfb-run -a node scripts/e2e-192-leave.cjs [只跑某组：ref|leave|lock|cross|stale|rounds]
const path = require('path'), fs = require('fs'), os = require('os');
const JSZip = require(path.join(__dirname, '../node_modules/jszip'));
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = path.join(__dirname, '../work/perf-3000');
const ONLY = process.argv[2] || '';
const REVIEWER = 'Perf Reviewer';
const N = 40;
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info).slice(0, 400) : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const perf = [];

function newEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-leave-'));
  for (const [s, d] of [['A', 'Document A.docx'], ['B', 'Document B.docx'], ['C', 'Document C.docx']]) fs.copyFileSync(path.join(FIX, `perf3000-${s}.docx`), path.join(dir, d));
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  fs.mkdirSync(path.join(cfg, 'DocDiff'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'DocDiff', 'settings.json'), JSON.stringify({ lang: 'zh', 'prefs-v2': { sound: false, reviewerName: REVIEWER, reviewerInitials: 'PR', reviewerAsked: true, mascotWalk: false } }));
  return { dir, cfg };
}
async function launch(env, files = []) {
  const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', ...(process.env.PACKAGED ? [] : [APP]), ...files.map((f) => path.join(env.dir, f))], env: { ...process.env, XDG_CONFIG_HOME: env.cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, Math.round(e.duration)]); }).observe({ type: 'longtask' }); });
  return { app, win, errs };
}
const text = (win, sel) => win.evaluate((s) => document.querySelector(s)?.innerText || '', sel);
const clickText = (win, sel, re) => win.evaluate(([s, r]) => { const b = [...document.querySelectorAll(s)].find((x) => new RegExp(r).test(x.textContent)); b?.click(); return !!b; }, [sel, re]);
const pickNext = (app, p) => app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
const waitCompared = (win) => win.waitForFunction(() => (!!document.querySelector('.tb-pos') || (!!document.querySelector('.review-bar') && !!document.querySelector('.dlist .drow'))) && !document.querySelector('.spinner'), null, { timeout: +(process.env.CMP_TIMEOUT || 180000) }).catch(async (e) => { if (process.env.SHOT) await win.screenshot({ path: process.env.SHOT }); throw e; });
const chip = (win) => win.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label') || '');
const drafts = (env) => fs.readdirSync(env.dir).filter((f) => f.endsWith('.docx') && !/^Document [ABC]\.docx$/.test(f) && !f.startsWith('~$'));
const tmpFiles = (env) => fs.readdirSync(env.dir).filter((f) => f.endsWith('.ddtmp'));
async function pickPair(win, row) {
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await sleep(250);
  await win.evaluate((i) => document.querySelectorAll('.ver-list .ver-row')[i].click(), row);
}
const verIs = (win, re) => win.waitForFunction((r) => new RegExp(r).test(document.querySelector('.ver-chip')?.innerText || ''), re.source, { timeout: 120000 });

// 往来稿 V1 / V2 / V3，停在 V1 → V2 的修订审阅；draft = true 时生成审阅稿并等第一次写好
async function setup(env, { draft = true } = {}) {
  const s = await launch(env, ['Document A.docx', 'Document B.docx']);
  const { app, win } = s;
  await waitCompared(win);
  await win.evaluate(() => document.querySelector('.filechip').click()); await sleep(250);
  await clickText(win, '.filechip-menu .menu-item', '存为往来稿');
  await win.waitForSelector('.ver-chip', { timeout: 20000 });
  await win.evaluate(() => document.querySelector('.ver-chip').click()); await sleep(200);
  await clickText(win, '.ver-pop .btn', '加入新版本');
  await win.waitForSelector('.tpl-dlg');
  await pickNext(app, path.join(env.dir, 'Document C.docx'));
  await win.evaluate(() => document.querySelector('.tpl-dlg .dlg-drop').click()); await sleep(600);
  await clickText(win, '.tpl-dlg .btn', '加入并比较');
  await verIs(win, /V2\s*→\s*V3/); await waitCompared(win);
  await pickPair(win, 1);
  await verIs(win, /V1\s*→\s*V2/); await waitCompared(win);
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(800);
  if (draft) {
    await pickNext(app, env.dir); // 对方文件是库里的拷贝时先问放哪个文件夹
    await win.evaluate(() => document.querySelector('.tb-start')?.click());
    for (let k = 0; k < 150 && !(drafts(env).length && /已保存/.test(await chip(win))); k++) await sleep(100);
    await win.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  }
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0]?.click()); await sleep(300);
  return s;
}
// 快速按 R：间隔约 25ms，不等写盘；返回按键期间的最长长任务、界面追上的时间
async function fastReject(win, n = N, key = 'r') {
  const t0 = await win.evaluate(() => performance.now());
  for (let i = 0; i < n; i++) { await win.keyboard.press(key); await sleep(25); }
  const tKeys = await win.evaluate(() => performance.now());
  await win.waitForFunction((n) => document.querySelectorAll('.dlist .drow.v-r').length >= n, n, { timeout: 10000 }).catch(() => {});
  const caught = Math.round((await win.evaluate(() => performance.now())) - tKeys);
  const long = await win.evaluate((t) => window.__long.filter((x) => x[0] >= t).map((x) => x[1]), t0);
  return { maxLong: Math.max(0, ...long), caughtUpMs: caught };
}
async function draftInfo(file) {
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  const x = await z.file('word/document.xml').async('string');
  let mine = 0, m; const re = /<w:(ins|del)\b[^>]*w:author="([^"]*)"/g;
  while ((m = re.exec(x))) if (m[2] === REVIEWER) mine++;
  // “接受全部修订”后的文字：去掉删除的部分，保留插入的部分
  const accepted = x.replace(/<w:del\b[^>]*>[\s\S]*?<\/w:del>/g, '').replace(/<w:moveFrom\b[^>]*>[\s\S]*?<\/w:moveFrom>/g, '');
  const txt = [...accepted.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((y) => y[1]).join('');
  return { mine, txt, mtime: fs.statSync(file).mtimeMs };
}
// 应用数据里每组比较的决定数：{ pk: { r, a, h } }
function records(env) {
  const d = path.join(env.cfg, 'DocDiff', 'reviews');
  const out = [];
  for (const f of fs.existsSync(d) ? fs.readdirSync(d) : []) {
    if (f === 'index.json' || !f.endsWith('.json')) continue;
    try { const j = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')); const recs = Object.values(j.data?.recs || {}); out.push({ pk: j.pk, r: recs.filter((x) => x.v === 'r').length, a: recs.filter((x) => x.v === 'a').length, draft: j.data?.draft?.path ? path.basename(j.data.draft.path) : '' }); } catch {}
  }
  return out;
}
function rounds(env) {
  const d = path.join(env.cfg, 'DocDiff', 'library', 'rounds');
  const out = [];
  for (const f of fs.existsSync(d) ? fs.readdirSync(d).filter((x) => x.endsWith('.json')) : []) { try { out.push(...JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))); } catch {} }
  return out;
}
const settings = (env) => { try { return JSON.parse(fs.readFileSync(path.join(env.cfg, 'DocDiff', 'settings.json'), 'utf8')); } catch { return {}; } };
async function waitStable(env, ms = 8000) {
  // 等后台写完：没有临时文件，且审阅稿修改时间 600ms 内不再变
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < ms) {
    const sig = drafts(env).map((f) => f + fs.statSync(path.join(env.dir, f)).mtimeMs).join() + tmpFiles(env).length;
    if (sig === last && !tmpFiles(env).length) return; last = sig; await sleep(600);
  }
}
// 离开：quit / new / switch；返回等待时间（毫秒）
async function leave(s, how) {
  const { app, win } = s;
  const t0 = Date.now();
  if (how === 'quit') { await app.close(); return Date.now() - t0; }
  if (how === 'new') { await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForSelector('.home', { timeout: 10000 }); return Date.now() - t0; }
  await pickPair(win, 2); await verIs(win, /V2\s*→\s*V3/); const ms = Date.now() - t0; await waitCompared(win); return ms;
}

let REF = null; // 不离开时写出的参考稿：40 处拒绝；再把第 1 处改成接受
async function ref() {
  const env = newEnv();
  const s = await setup(env);
  const keys = await fastReject(s.win);
  for (let k = 0; k < 100 && !/已保存/.test(await chip(s.win)); k++) await sleep(100);
  await waitStable(env);
  const f = path.join(env.dir, drafts(env)[0]);
  const r40 = await draftInfo(f);
  await s.win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await sleep(200);
  await s.win.keyboard.press('a');
  await sleep(400); for (let k = 0; k < 100 && !/已保存/.test(await chip(s.win)); k++) await sleep(100);
  await waitStable(env);
  const r39 = await draftInfo(f);
  await s.app.close();
  REF = { r40, r39 };
  perf.push({ case: 'ref (no leave)', ...keys });
  ok('reference: 40 fast rejections written when staying (reviewer revisions > 0)', r40.mine >= N, { mine: r40.mine, accepted: r39.mine });
}

async function leaveCase(how, when) {
  const env = newEnv();
  const s = await setup(env);
  const { app, win } = s;
  const f = path.join(env.dir, drafts(env)[0]);
  const before = await draftInfo(f);
  let release = null;
  if (when === 't1') await win.evaluate(() => { window.__ddDraftHooks = { debounceMs: 5000 }; });
  if (when === 't2') await win.evaluate(() => { window.__atHook = false; window.__ddDraftHooks = { afterBuild: () => { window.__atHook = true; return new Promise((r) => { window.__rel = r; }); } }; });
  if (when === 't3') await app.evaluate(() => { global.__ddSaveDelay = 2500; });
  const keys = await fastReject(win);
  if (when === 't2') { await win.waitForFunction(() => window.__atHook, null, { timeout: 10000 }); release = () => win.evaluate(() => { window.__ddDraftHooks = {}; window.__rel?.(); }).catch(() => {}); }
  if (when === 't3') { for (let k = 0; k < 100 && !tmpFiles(env).length; k++) await sleep(50); }
  const stuck = when === 't3' ? tmpFiles(env).length > 0 : when === 't2' ? true : (await draftInfo(f)).mtime === before.mtime;
  const tL = await win.evaluate(() => performance.now()).catch(() => 0);
  let leaveMs;
  if (how === 'quit') {
    const p = leave(s, how);
    if (release) { await sleep(300); await release(); }
    leaveMs = await p;
  } else {
    leaveMs = await leave(s, how);
    if (release) await release();
  }
  const long = how === 'quit' ? [] : await win.evaluate((t) => window.__long.filter((x) => x[0] >= t).map((x) => x[1]), tL);
  await waitStable(env);
  const after = await draftInfo(f);
  const recs = records(env).find((x) => x.r >= 1);
  if (how !== 'quit') { await app.evaluate(() => { global.__ddSaveDelay = 0; }); await app.close(); }
  perf.push({ case: `${how}/${when}`, ...keys, leaveMs, leaveMaxLong: Math.max(0, ...long) });
  ok(`${how} @${when}: timing reached (${when === 't1' ? 'debounce not run' : when === 't2' ? 'worker built, not committed' : 'main save in flight'})`, stuck);
  ok(`${how} @${when}: 40 decisions persisted`, recs?.r === N, recs);
  ok(`${how} @${when}: old redline rewritten with all 40 (text + reviewer revisions = reference)`, after.mtime !== before.mtime && after.mine === REF.r40.mine && after.txt === REF.r40.txt, { mine: after.mine, ref: REF.r40.mine, sameText: after.txt === REF.r40.txt });
  ok(`${how} @${when}: no pending record left`, !Object.keys(settings(env)['draft-pending'] || {}).length);
  return env;
}

async function lockCase() {
  // 1) Word 占着审阅稿时切版本：后台写不进去 → 提示；退出时没有遗漏的东西要问；重启后提示；关掉 Word 后打开这一对自动补写
  const env = newEnv();
  let s = await setup(env);
  const f = path.join(env.dir, drafts(env)[0]);
  const lock = path.join(env.dir, '~$' + path.basename(f));
  fs.writeFileSync(lock, 'x');
  await fastReject(s.win);
  await leave(s, 'switch');
  await s.win.waitForSelector('.behind-dlg', { timeout: 10000 }).catch(() => {});
  if (process.env.SHOTDIR) await s.win.screenshot({ path: path.join(process.env.SHOTDIR, 'behind-bg.png') });
  const bg = await text(s.win, '.behind-dlg');
  ok('locked + switch: dialog says 40 decisions not written, Word has it open, do not send', /40 个决定没写进去/.test(bg) && /Word 正在使用/.test(bg) && /不要把它发给对方/.test(bg), { bg: bg.slice(0, 200) });
  ok('locked + switch: pending recorded for restart', Object.values(settings(env)['draft-pending'] || {}).some((x) => x.behind === N));
  await clickText(s.win, '.behind-dlg .btn', '知道了');
  await s.app.close();
  s = await launch(env);
  await s.win.waitForSelector('.behind-dlg', { timeout: 15000 }).catch(() => {});
  const st = await text(s.win, '.behind-dlg');
  ok('restart: dialog lists the redline with 40 decisions not written and how to recover', /上次有决定没写进审阅稿/.test(st) && /40 个决定没写进去/.test(st) && /再打开这次比较时会自动补写/.test(st), { st: st.slice(0, 200) });
  await clickText(s.win, '.behind-dlg .btn', '知道了');
  fs.unlinkSync(lock);
  // 首页打开往来稿（回到上次的 V2 → V3），再从版本链切回 V1 → V2
  await s.win.evaluate(() => [...document.querySelectorAll('.mod-tabs button')].find((b) => /往来稿/.test(b.textContent))?.click()); await sleep(300);
  await s.win.evaluate(() => document.querySelector('.lib-rows .row-open')?.click());
  await verIs(s.win, /V2\s*→\s*V3/); await waitCompared(s.win);
  await pickPair(s.win, 1); await verIs(s.win, /V1\s*→\s*V2/); await waitCompared(s.win);
  for (let k = 0; k < 150 && !/已保存/.test(await chip(s.win)); k++) await sleep(100);
  await waitStable(env);
  const rec = await draftInfo(f);
  ok('reopen V1 → V2 after closing Word: redline recovered to the reference', rec.mine === REF.r40.mine && rec.txt === REF.r40.txt && /已保存/.test(await chip(s.win)), { mine: rec.mine });
  ok('recovered: pending record cleared', !Object.keys(settings(env)['draft-pending'] || {}).length);
  // 2) Word 占着时退出：退出前提示，可以“先不退出”或“仍然退出”
  fs.writeFileSync(lock, 'x');
  await s.win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await sleep(200);
  await s.win.keyboard.press('a'); await sleep(800);
  const closing = s.app.close();
  await s.win.waitForSelector('.behind-dlg', { timeout: 10000 }).catch(() => {});
  if (process.env.SHOTDIR) await s.win.screenshot({ path: path.join(process.env.SHOTDIR, 'behind-quit.png') });
  const q = await text(s.win, '.behind-dlg');
  ok('quit while Word has it open: asks before quitting (1 decision not written)', /还有决定没写进审阅稿/.test(q) && /1 个决定没写进去/.test(q) && /仍然退出/.test(q), { q: q.slice(0, 160) });
  // “先不退出”：留在应用里
  await clickText(s.win, '.behind-dlg .btn', '先不退出');
  await sleep(1500);
  ok('“先不退出” keeps the app open', !(await s.win.$('.behind-dlg')) && !!(await s.win.$('.review-bar')));
  const closing2 = s.app.close();
  await s.win.waitForSelector('.behind-dlg', { timeout: 10000 }).catch(() => {});
  await clickText(s.win, '.behind-dlg .btn', '仍然退出').catch(() => {}); // 点完应用就退了，页面随之关闭
  await closing2;
  void closing;
  ok('quit anyway: pending recorded for next start', Object.values(settings(env)['draft-pending'] || {}).some((x) => x.behind === 1));
  fs.unlinkSync(lock);
}

async function crossCase() {
  // 旧版本 40 处在主进程写盘中切到 V2 → V3；新版本另生成审阅稿、接受 1 处：两组记录、两份 Word 不串写
  const env = newEnv();
  const s = await setup(env);
  const { app, win } = s;
  const f1 = path.join(env.dir, drafts(env)[0]);
  await app.evaluate(() => { global.__ddSaveDelay = 2500; });
  await fastReject(win);
  for (let k = 0; k < 100 && !tmpFiles(env).length; k++) await sleep(50);
  await leave(s, 'switch');
  await app.evaluate(() => { global.__ddSaveDelay = 0; });
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await sleep(600);
  await win.evaluate(() => document.querySelector('.tb-start')?.click());
  for (let k = 0; k < 150 && drafts(env).length < 2; k++) await sleep(100);
  await win.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await sleep(200);
  await win.keyboard.press('a'); await sleep(500);
  for (let k = 0; k < 100 && !/已保存/.test(await chip(win)); k++) await sleep(100);
  await waitStable(env);
  const files = drafts(env);
  const f2 = path.join(env.dir, files.find((x) => path.join(env.dir, x) !== f1) || 'x');
  const d1 = await draftInfo(f1), d2 = fs.existsSync(f2) ? await draftInfo(f2) : null;
  const recs = records(env);
  ok('cross: two redlines (one per version pair)', files.length === 2, { files });
  ok('cross: V1 → V2 redline = reference (40 rejections)', d1.mine === REF.r40.mine && d1.txt === REF.r40.txt, { mine: d1.mine });
  ok('cross: V2 → V3 redline has no reviewer revisions (only 1 accept)', !!d2 && d2.mine === 0, { mine: d2?.mine });
  ok('cross: records 40 rejections / 1 accept, not mixed', recs.some((x) => x.r === N && x.a === 0) && recs.some((x) => x.a === 1 && x.r === 0), recs);
  await app.close();
}

async function staleCase() {
  // 旧保存（40 处）还在主进程里没写完：切到 V2 → V3 又马上切回 V1 → V2，把第 1 处改成接受；最终文件必须是最新决定
  const env = newEnv();
  const s = await setup(env);
  const { app, win } = s;
  const f = path.join(env.dir, drafts(env)[0]);
  await app.evaluate(() => { global.__ddSaveDelay = 3000; });
  await fastReject(win);
  for (let k = 0; k < 100 && !tmpFiles(env).length; k++) await sleep(50);
  await pickPair(win, 2); await verIs(win, /V2\s*→\s*V3/);
  await app.evaluate(() => { global.__ddSaveDelay = 0; });
  await pickPair(win, 1); await verIs(win, /V1\s*→\s*V2/); await waitCompared(win);
  const stillOld = tmpFiles(env).length > 0;
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await sleep(200);
  await win.keyboard.press('a'); await sleep(500);
  await waitStable(env, 12000);
  for (let k = 0; k < 100 && !/已保存/.test(await chip(win)); k++) await sleep(100);
  const d = await draftInfo(f);
  const recs = records(env);
  ok('stale: the old save was still in flight when the decision changed', stillOld);
  ok('stale: final redline reflects the newest decisions (39 rejections + 1 accept = reference)', d.mine === REF.r39.mine && d.txt === REF.r39.txt, { mine: d.mine, ref: REF.r39.mine });
  ok('stale: records 39 rejections + 1 accept', recs.some((x) => x.r === N - 1 && x.a === 1), recs);
  ok('stale: chip shows saved, not modified', /已保存/.test(await chip(win)), { chip: await chip(win) });
  await app.close();
}

async function roundsCase(how = 'switch') {
  // 不生成审阅稿：快速拒绝 40 处后马上切到 V2 → V3，再退出；轮次摘要保留 40 条，新版本不混入；重启后条款历史显示
  const env = newEnv();
  let s = await setup(env, { draft: false });
  await s.win.evaluate(() => { window.__ddRoundDelay = 5000; }); // 摘要等 5 秒才写：切版本时一定还没写
  await fastReject(s.win);
  await leave(s, how);
  if (how !== 'quit') { await sleep(300); await s.app.close(); }
  const rs = rounds(env);
  const r12 = rs.find((r) => r.decided === N), r23 = rs.filter((r) => r !== r12);
  ok(`rounds (${how}): V1 → V2 summary kept with 40 decided / 40 items`, !!r12 && r12.items.length === N && r12.items.every((x) => x.v === 'r'), rs.map((r) => ({ decided: r.decided, items: r.items?.length })));
  ok(`rounds (${how}): V2 → V3 has no old decisions mixed in`, r23.every((r) => !r.decided && !(r.items || []).length));
  ok(`rounds (${how}): review records kept (40 for V1 → V2, none for V2 → V3)`, records(env).filter((x) => x.r).length === 1 && records(env).some((x) => x.r === N));
  if (how !== 'switch') return;
  s = await launch(env);
  await s.win.evaluate(() => [...document.querySelectorAll('.mod-tabs button')].find((b) => /往来稿/.test(b.textContent))?.click()); await sleep(300);
  await s.win.evaluate(() => document.querySelector('.lib-rows .row-open')?.click());
  await verIs(s.win, /V2\s*→\s*V3/); await waitCompared(s.win);
  await s.win.evaluate(() => document.querySelectorAll('.dlist .drow')[0].click()); await sleep(400);
  const hist = await text(s.win, '.clause-hist');
  ok('restart: clause history shows the V2 decisions for a matching clause', /条款历史/.test(hist) && /V2/.test(hist), { hist: hist.slice(0, 120) });
  const decided = await s.win.evaluate(() => document.querySelectorAll('.dlist .drow.done').length);
  ok('restart: V2 → V3 starts with no decisions', decided === 0, { decided });
  await s.app.close();
}

(async () => {
  if (!ONLY || ONLY !== 'rounds') await ref();
  if (!ONLY || ONLY === 'leave') for (const how of (process.env.HOWS || 'switch,new,quit').split(',')) for (const when of (process.env.WHENS || 't1,t2,t3').split(',')) await leaveCase(how, when);
  if (!ONLY || ONLY === 'lock') await lockCase();
  if (!ONLY || ONLY === 'cross') await crossCase();
  if (!ONLY || ONLY === 'stale') await staleCase();
  if (!ONLY || ONLY === 'rounds') for (const how of ['switch', 'new', 'quit']) await roundsCase(how);
  console.log('\nperf (keys: longest main-thread task while pressing R 40× / ms until the list caught up; leave: wait / longest task):');
  for (const p of perf) console.log(`  ${p.case.padEnd(16)} keys maxLong ${p.maxLong}ms · caught up ${p.caughtUpMs}ms${p.leaveMs != null ? ` · leave ${p.leaveMs}ms · leave maxLong ${p.leaveMaxLong}ms` : ''}`);
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
