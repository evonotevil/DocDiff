// 1.9.3 PDF 段落对齐排查：base.pdf 和每个版式变体比较，记录两侧段落数、差异分类、富文本里“整段新增 / 删除”的数量。
// 理想结果：每个变体只有 1 处修改（三十日 → 十五日）。只用合成夹具（scripts/make-pdf-align.py）。
// 用法：xvfb-run -a node scripts/pdf-align-probe.cjs [输出.json]
const path = require('path'), fs = require('fs'), os = require('os');
const { _electron } = require(process.env.PW || '/opt/npm-tools/node_modules/playwright');
const E = process.env.ELECTRON || path.join(__dirname, '../node_modules/electron/dist/electron');
const APP = process.env.APP || path.join(__dirname, '..');
const FIX = process.env.FIX || path.join(__dirname, '../work/pdf-align');
const VARIANTS = (process.env.VARIANTS || 'same,size12,lead15,lead2,narrow,indent,pagebreak,spacing0').split(',');
(async () => {
  const out = [];
  for (const v of VARIANTS) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-align-'));
    const A = path.join(dir, 'Document A.pdf'), B = path.join(dir, 'Document B.pdf');
    fs.copyFileSync(path.join(FIX, 'base.pdf'), A); fs.copyFileSync(path.join(FIX, v + '.pdf'), B);
    const app = await _electron.launch({ executablePath: E, args: ['--no-sandbox', '--lang=zh-CN', APP, A, B], env: { ...process.env, XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'dd-cfg-')) } });
    const win = await app.firstWindow(); await win.setViewportSize({ width: 1440, height: 900 });
    await win.waitForFunction(() => !!document.querySelector('.tb-pos'), null, { timeout: 120000 }).catch(() => {});
    await win.waitForTimeout(800);
    const r = await win.evaluate(() => {
      const chips = Object.fromEntries([...document.querySelectorAll('.fchip')].map((c) => { const m = c.innerText.trim().match(/^(.+?)\s+(\d+)$/); return m ? [m[1], +m[2]] : [c.innerText, 0]; }));
      const side = (s) => document.querySelectorAll(`.rich [data-side="${s}"] .blk`).length;
      return { chips, blocksA: side('a'), blocksB: side('b'), total: document.querySelectorAll('.dlist .drow').length };
    });
    await app.close();
    out.push({ variant: v, ...r });
    console.log(v.padEnd(10), JSON.stringify(r));
  }
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
