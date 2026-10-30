// 模板与往来稿（1.8）：存在应用数据目录的 library/ 下。
// - index.json：模板、往来稿和它们的版本（只存元数据和段落指纹）；原子写入，失败抛出。
// - files/<sha256>.<ext>：每个版本文件的拷贝（按内容去重）。存拷贝不存路径：原文件挪走、改名、被改都不影响版本链。
// - 删除先做标记（可撤销），之后再保存时清理不再被引用的文件。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createLibrary(store) {
  const DIR = 'library';
  const INDEX = path.join(DIR, 'index.json');
  const filesDir = () => store.file(path.join(DIR, 'files'));
  const fileOf = (sha, ext) => path.join(filesDir(), `${sha}.${String(ext || 'bin').replace(/[^a-z0-9]/gi, '').toLowerCase()}`);
  const EMPTY = { v: 1, templates: [], threads: [] };

  const get = () => { const v = store.read(INDEX, null); return v && typeof v === 'object' ? { ...EMPTY, ...v } : { ...EMPTY }; };
  // 每份往来稿各轮的结论摘要单独存一个文件，首页读索引时不用带上它们
  const roundsFile = (id) => path.join(DIR, 'rounds', String(id).replace(/[^a-z0-9_-]/gi, '') + '.json');
  const readRounds = (id) => store.read(roundsFile(id), []);

  /** 引用到的文件 */
  const refs = (ix) => {
    const s = new Set();
    for (const t of ix.templates || []) for (const v of t.versions || []) if (v.file) s.add(`${v.file.sha}.${v.file.ext}`);
    for (const t of ix.threads || []) for (const v of t.versions || []) if (v.file) s.add(`${v.file.sha}.${v.file.ext}`);
    return s;
  };

  return {
    get,
    /** 整份保存。purge = true 时清理没被引用的文件（真正删除时用） */
    save(ix, purge) {
      if (!ix || typeof ix !== 'object' || !Array.isArray(ix.templates) || !Array.isArray(ix.threads)) throw new Error('bad library index');
      const slim = { ...ix, threads: ix.threads.map((t) => {
        const rs = t.rounds || [];
        // 渲染进程带了结论摘要的往来稿：写进它自己的文件；没带的（items 为空）保留磁盘上原来的
        if (rs.some((r) => Array.isArray(r.items))) {
          const old = new Map(readRounds(t.id).map((r) => [r.a + '|' + r.b, r.items]));
          store.write(roundsFile(t.id), rs.map((r) => ({ ...r, items: Array.isArray(r.items) ? r.items : old.get(r.a + '|' + r.b) || [] })));
        }
        return { ...t, rounds: rs.map(({ items, ...r }) => r) };
      }) };
      store.write(INDEX, slim);
      if (purge) {
        const live = new Set(ix.threads.map((t) => String(t.id).replace(/[^a-z0-9_-]/gi, '') + '.json'));
        try { const rd = store.file(path.join(DIR, 'rounds')); for (const f of fs.readdirSync(rd)) if (!live.has(f)) { try { fs.unlinkSync(path.join(rd, f)); } catch {} } } catch {}
        const keep = refs(ix);
        try { for (const f of fs.readdirSync(filesDir())) if (!keep.has(f)) { try { fs.unlinkSync(path.join(filesDir(), f)); } catch {} } } catch {}
      }
      return true;
    },
    /** 一份往来稿各轮的结论摘要 */
    rounds(id) { return readRounds(id); },
    /** 把一个文件拷进库里（已经有同样内容的就不再拷） */
    async putFile(src) {
      const data = await fs.promises.readFile(src);
      const sha = crypto.createHash('sha256').update(data).digest('hex');
      const ext = path.extname(src).slice(1).toLowerCase() || 'bin';
      const dst = fileOf(sha, ext);
      if (!fs.existsSync(dst)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        const tmp = `${dst}.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, data);
        await fs.promises.rename(tmp, dst);
      }
      const st = await fs.promises.stat(src);
      return { sha, ext, size: data.length, name: path.basename(src), mtime: st.mtimeMs };
    },
    /** 库里文件的完整路径（不存在返回 null） */
    pathOf(sha, ext) { const p = fileOf(sha, ext); return fs.existsSync(p) ? p : null; },
    /** 占用：文件数、字节数 */
    usage() {
      let n = 0, bytes = 0;
      try { for (const f of fs.readdirSync(filesDir())) { n++; try { bytes += fs.statSync(path.join(filesDir(), f)).size; } catch {} } } catch {}
      return { files: n, bytes };
    },
  };
}

module.exports = { createLibrary };
