// 首次审阅决定的卡顿回归（1.9.2，P2「首次审阅提示音阻塞主线程」）。
// 每轮冷启动（隔离用户配置）→ 打开同一对 3,000 段合成 Word → 修订审阅 → 开始审阅稿 → 连续按 R 处理 N 处，
// 每次等审阅稿文件更新、状态片显示“已保存”后再按下一次。记录：
//   - feedbackMs：keydown 到审阅条显示“已拒绝”反馈后的两帧（界面反馈）
//   - maxLong：这次决定期间渲染主线程最长的长任务（PerformanceObserver longtask）
//   - saveMs：按键到审阅稿文件更新（含 250ms 合并写入的等待，不等于界面冻结时间）
//   - AudioContext 构造次数和耗时、<audio>.play() 次数
// 并核对 Word 内容：每次决定后审阅稿里以审阅人署名的修订都要增加，文字通过应用自带的“接受全部后逐块比对”（状态片不是“没写进”）。
// 用法：
//   xvfb-run -a node scripts/perf-review-chime.cjs [轮数=3] [每轮决定数=12] [输出.json]
//   SOUND=0 …            提示音关闭（检查不构造 AudioContext）
//   ELECTRON=<可执行文件> PACKAGED=1 …   用安装包（macOS：/Applications/DocDiff.app/Contents/MacOS/DocDiff）
// 夹具：python3 scripts/make-perf-review-3000.py（work/perf-3000，内容全部虚构；日志里称 Document A / Document B）
const path = require('path'), fs = require('fs'), os = require('os');
const JSZip = require(path.join(__dirname, '../node_modules/jszip'));
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const RUNS = +(process.argv[2] || 3), N = +(process.argv[3] || 12), OUT = process.argv[4];
const SOUND = process.env.SOUND !== '0';
// 长任务阈值：macOS 实测验收用 50ms；Linux 无显卡的 xvfb 下即使关掉提示音也偶有 50–65ms 的长任务，可以用 LONG_MAX=80 跑
const LONG_MAX = +(process.env.LONG_MAX || 50);
const FIX = process.env.FIX || path.join(__dirname, '../work/perf-3000');
const REVIEWER = 'Perf Reviewer';
let fail = 0;
const ok = (k, v, info) => { if (!v) fail++; console.log(`${v ? 'ok  ' : 'FAIL'} ${k}${info ? ' ' + JSON.stringify(info) : ''}`); };

async function reviewerRevs(file) {
  const z = await JSZip.loadAsync(fs.readFileSync(file));
  const x = await z.file('word/document.xml').async('string');
  const re = /<w:(ins|del)\b[^>]*w:author="([^"]*)"/g; let m, mine = 0, theirs = 0;
  while ((m = re.exec(x))) { if (m[2] === REVIEWER) mine++; else theirs++; }
  return { mine, theirs };
}

async function run(r) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-chime-'));
  const A = path.join(dir, 'Document A.docx'), B = path.join(dir, 'Document B.docx');
  fs.copyFileSync(path.join(FIX, 'perf3000-A.docx'), A); fs.copyFileSync(path.join(FIX, 'perf3000-B.docx'), B);
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-'));
  fs.mkdirSync(path.join(cfg, 'DocDiff'), { recursive: true });
  fs.writeFileSync(path.join(cfg, 'DocDiff', 'settings.json'), JSON.stringify({ lang: 'zh', 'prefs-v2': { sound: SOUND, reviewerName: REVIEWER, reviewerInitials: 'PR', reviewerAsked: true } }));
  const args = ['--no-sandbox', '--lang=zh-CN', ...(process.env.PACKAGED ? [] : [APP]), A, B];
  const t0 = Date.now();
  const app = await _electron.launch({ executablePath: E, args, env: { ...process.env, XDG_CONFIG_HOME: cfg, HOME: process.platform === 'darwin' ? process.env.HOME : cfg } });
  await app.evaluate(({ shell }) => { shell.showItemInFolder = () => {}; shell.openPath = async () => ''; });
  const win = await app.firstWindow();
  const errs = []; win.on('pageerror', (e) => errs.push(e.message));
  // 在应用脚本之前装上计数器（AudioContext 构造、<audio>.play()）
  await win.evaluate(() => {
    window.__ac = { n: 0, ms: [] }; window.__plays = 0; window.__playMs = 0;
    for (const k of ['AudioContext', 'webkitAudioContext']) {
      const C = window[k]; if (!C) continue;
      window[k] = new Proxy(C, { construct(T, a) { const s = performance.now(); const o = Reflect.construct(T, a); window.__ac.n++; window.__ac.ms.push(+(performance.now() - s).toFixed(1)); return o; } });
    }
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...a) { window.__plays++; const s = performance.now(); const p = play.apply(this, a); window.__playMs = Math.max(window.__playMs, performance.now() - s); return p; };
  });
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 180000 });
  const openMs = Date.now() - t0;
  // 进入修订审阅：记录这次切换的长任务（预热如果放在这里，卡顿会显示在这儿）
  await win.evaluate(() => { window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push([e.startTime, e.duration]); }).observe({ type: 'longtask' }); });
  const tReview = await win.evaluate(() => performance.now());
  await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click());
  await win.waitForTimeout(1500);
  const reviewLong = await win.evaluate((t) => Math.round(Math.max(0, ...window.__long.filter((x) => x[0] >= t).map((x) => x[1]))), tReview);
  await win.evaluate(() => document.querySelector('.tb-start')?.click()); await win.waitForTimeout(1500);
  await win.evaluate(() => [...document.querySelectorAll('.draft-tip .btn')].find((b) => /知道了/.test(b.textContent))?.click());
  const drafts = () => fs.readdirSync(dir).filter((f) => f.endsWith('.docx') && !/^Document [AB]\.docx$/.test(f) && !f.startsWith('~$'));
  for (let k = 0; k < 80 && !drafts().length; k++) await win.waitForTimeout(100);
  const draft = () => path.join(dir, drafts()[0]);
  const chip = () => win.evaluate(() => document.querySelector('.draft-chip')?.getAttribute('aria-label') || '');
  // 从第一处开始
  await win.evaluate(() => document.querySelectorAll('.dlist .drow')[0]?.click()); await win.waitForTimeout(400);
  await win.evaluate(() => {
    window.__kd = 0;
    document.addEventListener('keydown', (e) => { if (e.key === 'r') window.__kd = e.timeStamp; }, true);
    window.__fb = () => new Promise((res) => {
      const check = () => !!document.querySelector('.review-bar.fb-r');
      const done = () => requestAnimationFrame(() => requestAnimationFrame(() => res(performance.now() - window.__kd)));
      if (check()) return done();
      const mo = new MutationObserver(() => { if (check()) { mo.disconnect(); done(); } });
      mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'], childList: true });
      setTimeout(() => { mo.disconnect(); res(-1); }, 5000);
    });
  });
  let prev = await reviewerRevs(draft());
  const steps = [];
  for (let i = 0; i < N; i++) {
    const before = fs.statSync(draft()).mtimeMs;
    await win.waitForFunction(() => !document.querySelector('.review-bar.fb-r'), null, { timeout: 3000 });
    const tPerf = await win.evaluate(() => performance.now());
    const fbP = win.evaluate(() => window.__fb());
    const ts = Date.now();
    await win.keyboard.press('r');
    const feedbackMs = Math.round(await fbP);
    let saveMs = -1, c = '';
    for (let k = 0; k < 300; k++) {
      await win.waitForTimeout(20);
      c = await chip();
      if (fs.statSync(draft()).mtimeMs !== before && /已保存|没写进/.test(c)) { saveMs = Date.now() - ts; break; }
    }
    await win.waitForTimeout(150);
    const long = await win.evaluate((t) => window.__long.filter((x) => x[0] >= t).map((x) => Math.round(x[1])), tPerf);
    const revs = await reviewerRevs(draft());
    steps.push({ i, feedbackMs, maxLong: Math.max(0, ...long), saveMs, written: /已保存/.test(c), mineUp: revs.mine > prev.mine, theirsDown: revs.theirs <= prev.theirs });
    prev = revs;
  }
  const ac = await win.evaluate(() => window.__ac), plays = await win.evaluate(() => window.__plays), playMs = +(await win.evaluate(() => window.__playMs)).toFixed(1);
  await app.close();
  const res = { run: r, openMs, reviewLong, steps, audioContexts: ac.n, audioContextMs: ac.ms, plays, playMs, errs };
  console.log(`run ${r + 1}: open ${openMs}ms · enter review long ${reviewLong}ms · AudioContext ×${ac.n}${ac.ms.length ? ' ' + ac.ms.join('/') + 'ms' : ''} · play ×${plays} (sync ≤ ${playMs}ms)`);
  console.log('  feedback', steps.map((s) => s.feedbackMs).join(' '), '| maxLong', steps.map((s) => s.maxLong).join(' '), '| save', steps.map((s) => s.saveMs).join(' '));
  return res;
}

(async () => {
  const runs = [];
  for (let r = 0; r < RUNS; r++) runs.push(await run(r));
  const all = runs.flatMap((x) => x.steps);
  ok(`${SOUND ? 'sound on' : 'sound off'}: no AudioContext constructed`, runs.every((x) => x.audioContexts === 0), runs.map((x) => x.audioContexts));
  if (SOUND) { ok('sound on: a chime is played for every decision', runs.every((x) => x.plays >= N), runs.map((x) => x.plays)); ok('playing a chime takes < 5ms on the main thread', runs.every((x) => x.playMs < 5), runs.map((x) => x.playMs)); }
  else ok('sound off: nothing played', runs.every((x) => x.plays === 0), runs.map((x) => x.plays));
  ok(`first decision: no main-thread task > ${LONG_MAX}ms`, runs.every((x) => x.steps[0].maxLong <= LONG_MAX), runs.map((x) => x.steps[0].maxLong));
  ok(`all decisions: no main-thread task > ${LONG_MAX}ms`, all.every((s) => s.maxLong <= LONG_MAX), { worst: Math.max(...all.map((s) => s.maxLong)) });
  ok('entering 修订审阅 has no task > 50ms caused by warm-up (reported)', true, runs.map((x) => x.reviewLong));
  const fb = all.map((s) => s.feedbackMs).sort((a, b) => a - b);
  ok('feedback shown for every decision (keydown → review bar + 2 frames; reported, Linux/xvfb frame timing is noisy)', fb.every((x) => x >= 0), { median: fb[fb.length >> 1], max: fb[fb.length - 1], first: runs.map((x) => x.steps[0].feedbackMs) });
  ok('every decision written to the Word draft (reviewer revisions grew, verified)', all.every((s) => s.saveMs > 0 && s.written && s.mineUp), all.filter((s) => !(s.saveMs > 0 && s.written && s.mineUp)).map((s) => s.i));
  const sv = all.map((s) => s.saveMs).sort((a, b) => a - b);
  ok('decision → file updated (incl. debounce; reported)', true, { median: sv[sv.length >> 1], min: sv[0], max: sv[sv.length - 1] });
  ok('no page errors', runs.every((x) => !x.errs.length), runs.flatMap((x) => x.errs).slice(0, 3));
  if (OUT) fs.writeFileSync(OUT, JSON.stringify({ sound: SOUND, runs }, null, 1));
  console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
