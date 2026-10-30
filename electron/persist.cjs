// 本机持久化（1.7.3）：应用数据目录里的 JSON 文件。
// - 原子写入：先写 .tmp 并刷盘，再改名替换；替换前把上一份留作 .bak。写到一半断电也不会留下坏文件。
// - 失败不再静默：write 失败会抛出，调用方把错误告诉界面。
// - 读取时主文件坏了就用 .bak；主文件坏了时不会拿它覆盖 .bak（1.8 beta.5）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function createStore(rootDir) {
  const root = typeof rootDir === 'function' ? rootDir : () => rootDir;
  const file = (n) => path.join(root(), n);
  const ensureDir = (p) => fs.mkdirSync(path.dirname(p), { recursive: true });

  // 已知完好的主文件（读出来能解析、或是我们刚写成功的）：路径 → 当时的修改时间和大小
  const good = new Map();
  const statOf = (p) => { try { const s = fs.statSync(p); return { m: s.mtimeMs, z: s.size }; } catch { return null; } };
  const markGood = (p) => { const s = statOf(p); if (s) good.set(p, s); else good.delete(p); };
  /** 主文件现在是不是完好的：和记下的一致就不用再解析；否则解析一遍确认 */
  function mainIsValid(p) {
    const s = statOf(p);
    if (!s) return false;
    const g = good.get(p);
    if (g && g.m === s.m && g.z === s.z) return true;
    try { JSON.parse(fs.readFileSync(p, 'utf8')); good.set(p, s); return true; } catch { return false; }
  }

  function readFile(p) {
    try { const v = JSON.parse(fs.readFileSync(p, 'utf8')); markGood(p); return v; } catch {}
    try { return JSON.parse(fs.readFileSync(p + '.bak', 'utf8')); } catch {}
    return undefined;
  }

  function writeFile(p, value) {
    // 回归测试用：模拟磁盘写不进去（只读、满了、被占用）
    if (process.env.DOCDIFF_TEST_FAIL_WRITES === '1') throw Object.assign(new Error('EACCES: permission denied (simulated)'), { code: 'EACCES' });
    ensureDir(p);
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    const data = JSON.stringify(value, null, 1);
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, data);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    try {
      // 只把“完好的”主文件轮换成备份。主文件坏了（读的时候已经退回到 .bak）就保留现有的 .bak，
      // 直到新的主文件替换成功——中途失败时，.bak 仍然是一份能读的数据（1.8 beta.5）
      if (mainIsValid(p)) fs.copyFileSync(p, p + '.bak');
      fs.renameSync(tmp, p);
      markGood(p);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch {}
      throw e;
    }
  }

  function removeFile(p) {
    good.delete(p);
    for (const f of [p, p + '.bak']) { try { fs.unlinkSync(f); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  }

  return {
    file,
    /** 读不到时返回 def */
    read(n, def) { const v = readFile(file(n)); return v === undefined ? def : v; },
    /** 失败会抛出 */
    write(n, v) { writeFile(file(n), v); },
    /** 失败返回 false，用于窗口位置这类无关紧要的数据 */
    tryWrite(n, v) { try { writeFile(file(n), v); return true; } catch { return false; } },
    readFile,
    writeFile,
    removeFile,
  };
}

// ---------- 审阅记录：每组比较（两份文件的 SHA-256）一个文件 ----------
function createReviewStore(store) {
  const DIR = 'reviews';
  const INDEX = path.join(DIR, 'index.json');
  const fileOf = (pk) => path.join(DIR, crypto.createHash('sha256').update(pk).digest('hex').slice(0, 32) + '.json');

  const index = () => store.read(INDEX, {});
  const writeIndex = (ix) => store.write(INDEX, ix);

  return {
    /** 一组比较的完整记录；没有时返回 null */
    get(pk) {
      if (!pk) return null;
      const v = store.read(fileOf(pk), null);
      return v && v.pk === pk ? v.data : null;
    },
    /** 所有比较的进度摘要（最近比较列表用）：{ pk: { updated, total, decided } } */
    index,
    /** 保存一组；data 为 null 表示删除。失败抛出 */
    save(pk, data) {
      if (!pk) return;
      const ix = index();
      if (data) {
        store.write(fileOf(pk), { pk, data });
        ix[pk] = { updated: data.updated, total: data.total, decided: data.decided };
      } else {
        store.removeFile(store.file(fileOf(pk)));
        delete ix[pk];
      }
      writeIndex(ix);
    },
    /** 从旧版 localStorage 搬过来：只补本机还没有、或比本机新的记录 */
    importAll(all) {
      const ix = index();
      let n = 0;
      for (const [pk, data] of Object.entries(all || {})) {
        if (!data || typeof data !== 'object' || !data.recs) continue;
        if (ix[pk] && ix[pk].updated >= (data.updated || 0)) continue;
        store.write(fileOf(pk), { pk, data });
        ix[pk] = { updated: data.updated || Date.now(), total: data.total || 0, decided: data.decided || 0 };
        n++;
      }
      writeIndex(ix);
      return n;
    },
    /** 占用情况：组数、字节数、最早一组的时间 */
    usage() {
      const ix = index();
      let bytes = 0;
      for (const pk of Object.keys(ix)) { try { bytes += fs.statSync(store.file(fileOf(pk))).size; } catch {} }
      const times = Object.values(ix).map((x) => x.updated || 0).filter(Boolean);
      return { count: Object.keys(ix).length, bytes, oldest: times.length ? Math.min(...times) : 0 };
    },
    /** 清理：olderThan 毫秒时间戳之前的；all 为 true 时全部清空。返回删掉的组数 */
    clean({ olderThan, all }) {
      const ix = index();
      let n = 0;
      for (const [pk, v] of Object.entries(ix)) {
        if (all || (olderThan && (v.updated || 0) < olderThan)) {
          store.removeFile(store.file(fileOf(pk)));
          delete ix[pk];
          n++;
        }
      }
      writeIndex(ix);
      return n;
    },
  };
}

module.exports = { createStore, createReviewStore };
