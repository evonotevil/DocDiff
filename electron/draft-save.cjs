// 审阅稿写盘（1.8；beta.5 加固）：先写临时文件，再改名替换；绝不覆盖别人改过的文件。
// - 同一路径的写入排队，一个写完、登记完再写下一个；
// - 临时文件名带随机串，同一路径的并发写入不会共用临时文件；
// - 临时文件写完后、改名前再核对一次目标文件，写临时文件期间被外部改过就放弃（剩下的是改名前的极短窗口）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const statOf = (p) => { try { const s = fs.statSync(p); return { mtime: s.mtimeMs, size: s.size }; } catch { return null; } };
// Word 打开文件时在同一目录放一个 “~$” 开头的占用文件（名字长时替换前两个字符）
function wordLock(p) {
  const dir = path.dirname(p), base = path.basename(p);
  const cands = ['~$' + base, '~$' + base.slice(2), '~$' + base.slice(1)];
  return cands.some((c) => { try { return fs.existsSync(path.join(dir, c)); } catch { return false; } });
}
function check(p, expect) {
  const cur = statOf(p);
  // expect = 上次我们写完后的状态；null = 第一次创建
  if (cur && !expect) return { ok: false, code: 'exists' };
  if (cur && expect && (Math.abs(cur.mtime - expect.mtime) > 1 || cur.size !== expect.size)) return { ok: false, code: 'modified' };
  if (expect && !cur) return { ok: false, code: 'gone' };
  if (cur && wordLock(p)) return { ok: false, code: 'locked' };
  return null;
}
const queues = new Map();
/** hooks.afterTemp：测试用，临时文件写完、改名前调用 */
function saveDraft({ path: p, data, expect }, hooks = {}) {
  const run = async () => {
    if (!p || !/\.docx$/i.test(p)) return { ok: false, code: 'error', error: 'bad path' };
    const bad = check(p, expect);
    if (bad) return bad;
    const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.ddtmp`);
    try { await fs.promises.writeFile(tmp, Buffer.from(data)); }
    catch (err) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, code: ['EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(err.code) ? 'nowrite' : 'error', error: String(err.code || err.message) }; }
    if (hooks.afterTemp) await hooks.afterTemp();
    const again = check(p, expect);
    if (again) { try { fs.unlinkSync(tmp); } catch {} return again; }
    try { fs.renameSync(tmp, p); }
    catch (err) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, code: ['EBUSY', 'EPERM', 'EACCES'].includes(err.code) ? 'locked' : 'error', error: String(err.code || err.message) }; }
    return { ok: true, stat: statOf(p) };
  };
  const prev = queues.get(p) || Promise.resolve();
  const next = prev.then(run, run);
  queues.set(p, next.catch(() => {}));
  next.finally(() => { if (queues.get(p) === next) queues.delete(p); }).catch(() => {});
  return next;
}
module.exports = { saveDraft, statOf, wordLock };
