// 回归测试（1.7.2）：先比一组文件，再“新建比较”另一组，检查是否白屏。用法：xvfb-run node scripts/e2e-new-compare.cjs [none|review|filter|image|select] [short]
const { _electron } = require(process.env.PW || 'playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const E = '/home/claude/docdiff/node_modules/electron/dist/electron', S = '/home/claude/samples';
const pairs = [['合同_v1.docx','合同_v2.docx'],['normal_v1.txt','normal_v2.txt'],['合同_v1.pdf','合同_v2.pdf'],['split_A.pdf','split_B.docx'],['big_v1.docx','big_v2.docx']];
// 样例不全时只用现有的（1.7.4：云端环境重置后 samples 里只剩部分文件）
for (let i = pairs.length - 1; i >= 0; i--) if (!pairs[i].every((f) => fs.existsSync(`${S}/${f}`))) pairs.splice(i, 1);
if (process.env.EXTRA_PAIRS) for (const x of process.env.EXTRA_PAIRS.split(';')) pairs.push(x.split(','));
const pre = process.argv[2] || 'none';
if (process.argv[3] === 'short') pairs.splice(0, pairs.length, ['big_v1.docx','big_v2.docx'], ['合同_v1.docx','合同_v2.docx'], ['split_A.pdf','split_B.docx']);
(async () => {
  for (const [a1, b1] of pairs) for (const [a2, b2] of pairs) {
    const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', '/home/claude/docdiff', a1.startsWith('/') ? a1 : `${S}/${a1}`, b1.startsWith('/') ? b1 : `${S}/${b1}`], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'nc-')) } });
    const win = await app.firstWindow(); const errs = [];
    win.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 4).join(' | ')));
    win.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 300)); });
    await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForSelector('.tbar', { state: 'attached', timeout: 60000 }); await win.waitForTimeout(2500);
    if (pre === 'review') { await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[2].click()); await win.waitForTimeout(800); await win.keyboard.press('a'); await win.waitForTimeout(400); }
    if (pre === 'filter') { await win.evaluate(() => document.querySelectorAll('.chips .fchip')[1]?.click()); await win.waitForTimeout(300); }
    if (pre === 'image') { await win.evaluate(() => document.querySelectorAll('.nav-list .nav-item')[3].click()); await win.waitForTimeout(2500); }
    if (pre === 'select') { await win.evaluate(() => document.querySelectorAll('.dlist .drow')[2]?.click()); await win.waitForTimeout(500); }
    await win.evaluate(() => [...document.querySelectorAll('.nav-foot .nav-item')][0].click()); await win.waitForTimeout(600);
    const pick = async (p, side) => {
      await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, p);
      await app.evaluate(({ BrowserWindow }, c) => BrowserWindow.getAllWindows()[0].webContents.send('menu', c), side);
      await win.waitForTimeout(1500);
    };
    await pick(a2.startsWith('/') ? a2 : `${S}/${a2}`, 'open-left'); await pick(b2.startsWith('/') ? b2 : `${S}/${b2}`, 'open-right');
    await win.locator('.home-cta .btn.primary').click({ timeout: 10000 }).catch((e) => errs.push('noclick'));
    await win.waitForTimeout(3500);
    const len = await win.evaluate(() => document.getElementById('root').innerHTML.length);
    console.log(pre, a1, '->', a2, len < 100 ? 'WHITE' : 'ok', errs.slice(0, 2).join(' || '));
    await app.close();
  }
})();
