// DocDiff — Electron 主进程
const { app, BrowserWindow, ipcMain, dialog, protocol, net, Menu, shell, nativeTheme, Notification, clipboard, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

const DIST = path.join(__dirname, '..', 'dist');
const isMac = process.platform === 'darwin';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

let mainWin = null;

// ---------- 界面语言（菜单、对话框） ----------
let LANG = 'zh';
const MENU_EN = {
  文件: 'File', '打开原始文档…': 'Open original…', '打开修改后文档…': 'Open revised…', 交换左右: 'Swap sides',
  新建比较: 'New comparison', 关闭窗口: 'Close window', 退出: 'Quit', 编辑: 'Edit', 视图: 'View',
  富文本: 'Rich text', 纯文本: 'Plain text', 修订审阅: 'Review changes', 图像: 'Image', 'OCR 文本': 'OCR text', 文件详情: 'File details',
  '下一处差异（J）': 'Next difference (J)', '上一处差异（K）': 'Previous difference (K)', '收起 / 展开侧栏': 'Toggle sidebar', '收起 / 展开检查器': 'Toggle inspector',
  重新加载: 'Reload', 开发者工具: 'Developer tools', 实际大小: 'Actual size', 放大: 'Zoom in', 缩小: 'Zoom out',
  全屏: 'Full screen', 窗口: 'Window', 文档: 'Documents', 所有文件: 'All files',
};
const L = (zh) => (LANG === 'en' ? (MENU_EN[zh] || zh) : zh);

// ---------- 平台差异集中在这里（Windows 适配预埋） ----------
// Windows 10 不支持自定义标题栏覆盖层的颜色（会露出系统默认的灰条），
// 所以 Win10 回落到系统标准标题栏，Win11（build ≥ 22000）及 Linux 继续用覆盖层。
const winBuild = () => { const m = /^\d+\.\d+\.(\d+)/.exec(os.release() || ''); return m ? Number(m[1]) : 0; };
const isWin = process.platform === 'win32';
const useOverlay = !isMac && (!isWin || winBuild() >= 22000);

const PLATFORM = {
  isMac,
  isWin,
  useOverlay,
  // macOS 用隐藏标题栏 + 红绿灯；Win11 / Linux 用隐藏标题栏 + 系统按钮覆盖层；Win10 用系统标题栏
  windowChrome: (dark) => isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 20 } }
    : useOverlay
      ? { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(dark) }
      : {},
};

// ---------- 持久化：窗口位置 / 最近比较 / 审阅记录 / 设置（1.7.3 起原子写入，失败会告诉界面） ----------
const { createStore, createReviewStore } = require('./persist.cjs');
const store = createStore(() => app.getPath('userData'));
const reviews = createReviewStore(store);
const { createLibrary } = require('./library.cjs');
const library = createLibrary(store);
/** 写失败时通知界面（非阻塞警告）；成功时也通知，界面据此收起警告 */
function reportPersist(kind, err) {
  try { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('persist-status', { kind, ok: !err, error: err ? String(err.message || err) : '' }); } catch {}
}
function safeWrite(kind, n, v) {
  try { store.write(n, v); reportPersist(kind, null); return true; } catch (e) { reportPersist(kind, e); return false; }
}
function restoreBounds() {
  const b = store.read('window.json', null);
  if (!b) return { width: 1440, height: 920 };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100;
  });
  return visible ? b : { width: b.width || 1440, height: b.height || 920 };
}
const overlayFor = (dark) => ({ color: dark ? '#131f24' : '#ffffff', symbolColor: dark ? '#f1f7fb' : '#4b4b4b', height: 56 });

function createWindow() {
  const bounds = restoreBounds();
  mainWin = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 680,
    show: false,
    title: 'DocDiff',
    ...PLATFORM.windowChrome(nativeTheme.shouldUseDarkColors),
    icon: path.join(__dirname, '..', 'build', isMac ? 'icon.png' : 'icon-win.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#131f24' : '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWin.loadURL('app://local/index.html');
  mainWin.once('ready-to-show', () => { if (bounds.maximized) mainWin.maximize(); mainWin.show(); });
  const saveBounds = () => { if (!mainWin || mainWin.isDestroyed()) return; store.tryWrite('window.json', { ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() }); };
  mainWin.on('close', saveBounds);
  mainWin.on('closed', () => { mainWin = null; });
  // 全屏时 macOS 红绿灯隐藏，工具栏不再给它留位置（1.7.1）
  const sendFs = (v) => { if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('menu', 'fullscreen', v); };
  mainWin.on('enter-full-screen', () => sendFs(true));
  mainWin.on('leave-full-screen', () => sendFs(false));
  mainWin.webContents.on('did-finish-load', () => sendFs(mainWin.isFullScreen()));
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // 阻止把文件拖进窗口时直接导航
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('app://')) e.preventDefault();
  });
}

function buildMenu() {
  const send = (ch, ...a) => mainWin && mainWin.webContents.send(ch, ...a);
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: L('文件'),
      submenu: [
        { label: L('打开原始文档…'), accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-left') },
        { label: L('打开修改后文档…'), accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'open-right') },
        { type: 'separator' },
        { label: L('交换左右'), accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'swap') },
        { label: L('新建比较'), accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'clear') },
        { type: 'separator' },
        isMac ? { role: 'close', label: L('关闭窗口') } : { role: 'quit', label: L('退出') },
      ],
    },
    { role: 'editMenu', label: L('编辑') },
    {
      label: L('视图'),
      submenu: [
        ...['富文本', '纯文本', '修订审阅', '图像', 'OCR 文本', '文件详情'].map((l, i) => ({
          label: L(l), accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('menu', 'tab', i),
        })),
        { type: 'separator' },
        { label: L('下一处差异（J）'), accelerator: 'F7', click: () => send('menu', 'next') },
        { label: L('上一处差异（K）'), accelerator: 'Shift+F7', click: () => send('menu', 'prev') },
        { type: 'separator' },
        { label: L('收起 / 展开侧栏'), accelerator: isMac ? 'Ctrl+Cmd+S' : 'Ctrl+Alt+S', click: () => send('menu', 'toggle-nav') },
        { label: L('收起 / 展开检查器'), accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Alt+I', click: () => send('menu', 'toggle-aside') },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'reload', label: L('重新加载') }, { role: 'toggleDevTools', label: L('开发者工具') }, { type: 'separator' }]),
        { role: 'resetZoom', label: L('实际大小') },
        { role: 'zoomIn', label: L('放大') },
        { role: 'zoomOut', label: L('缩小') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L('全屏') },
      ],
    },
    { role: 'windowMenu', label: L('窗口') },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------- 文件读取 ----------
const EXT_OK = ['docx', 'pdf', 'txt', 'md', 'text', 'log', 'csv'];
async function readDoc(p) {
  const st = await fs.promises.stat(p);
  const data = await fs.promises.readFile(p);
  return {
    path: p,
    name: path.basename(p),
    ext: path.extname(p).slice(1).toLowerCase(),
    size: st.size,
    mtime: st.mtimeMs,
    birthtime: st.birthtimeMs,
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
  };
}

ipcMain.handle('open-dialog', async () => {
  const r = await dialog.showOpenDialog(mainWin, {
    properties: ['openFile'],
    filters: [
      { name: L('文档'), extensions: ['docx', 'pdf', 'txt', 'md'] },
      { name: L('所有文件'), extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

ipcMain.handle('read-path', async (_e, p) => readDoc(p));

ipcMain.handle('chrome-info', () => ({ chrome: useOverlay ? 'overlay' : 'system', winBuild: isWin ? winBuild() : 0 }));

// ---------- 检查更新（阶段 0：只检查，不下载安装） ----------
// 为什么不做自动下载安装：electron-builder 官方明确要求 "macOS application must be signed in
// order for auto updating to work"，而本应用目前未签名；Windows 侧未签名的 exe 也会被企业防火墙
// 和 SmartScreen 拦在下载那一步。所以这里只做"发现新版本 + 打开下载页"，等证书到位后再接
// electron-updater（配置方式见 docs/UPDATE.md）。
const UPDATE_FEED = process.env.DOCDIFF_UPDATE_FEED
  || (() => { try { return fs.readFileSync(path.join(app.getPath('userData'), 'update-feed.txt'), 'utf8').trim(); } catch { return ''; } })()
  || 'https://docdiff.app/updates/latest.json';

/** 1.5.0 > 1.4.10：按段比较数字，不做字符串比较 */
function cmpVer(a, b) {
  const pa = String(a).split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** 把底层网络错误翻成人话；原始信息留在 raw 里只写日志，不往界面上甩 */
function netMsg(e) {
  const m = String((e && (e.cause && e.cause.code)) || (e && e.message) || e);
  if (e && e.name === 'AbortError') return '连接超时';
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(m)) return '找不到更新服务器';
  if (/ECONNREFUSED|ECONNRESET|EPIPE|fetch failed|socket hang up/i.test(m)) return '连不上更新服务器';
  if (/CERT|SSL|TLS/i.test(m)) return '证书校验没通过';
  if (/^HTTP 4/.test(m)) return '更新地址不存在';
  if (/^HTTP 5/.test(m)) return '更新服务器出错了';
  return '网络不可用';
}

ipcMain.handle('check-update', async () => {
  const current = app.getVersion();
  if (!UPDATE_FEED) return { status: 'off', current };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    // 只是一个普通的静态 JSON GET，不携带任何文档信息
    const r = await fetch(UPDATE_FEED, { signal: ac.signal, cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const latest = String(j.version || '').trim();
    if (!latest) throw new Error('feed 里没有 version 字段');
    const key = isMac ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64') : isWin ? 'win-exe' : 'linux';
    const url = (j.downloads && (j.downloads[key] || j.downloads.page)) || j.page || '';
    return {
      status: cmpVer(latest, current) > 0 ? 'new' : 'latest',
      current, latest, url,
      notes: typeof j.notes === 'string' ? j.notes.slice(0, 4000) : '',
      pubDate: j.pubDate || '',
      minSupported: j.minSupported || '',
    };
  } catch (e) {
    return { status: 'error', current, error: netMsg(e) };
  } finally {
    clearTimeout(timer);
  }
});

ipcMain.handle('open-url', (_e, u) => {
  // 只允许 https，免得这个口子被当成任意协议的跳板
  if (typeof u === 'string' && /^https:\/\//i.test(u)) { shell.openExternal(u); return true; }
  return false;
});

ipcMain.handle('set-lang', (_e, l) => { if (l === 'en' || l === 'zh') { LANG = l; buildMenu(); } });

ipcMain.handle('save-file', async (_e, { defaultName, data, filters }) => {
  const r = await dialog.showSaveDialog(mainWin, { defaultPath: defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.on('theme', (_e, t) => {
  nativeTheme.themeSource = t;
  if (useOverlay && mainWin) { try { mainWin.setTitleBarOverlay(overlayFor(t === 'dark')); } catch {} }
});

// 最近比较
ipcMain.handle('recent-get', () => store.read('recent.json', []).filter((r) => r.a && r.b));
ipcMain.handle('recent-add', (_e, entry) => {
  let list = store.read('recent.json', []);
  const key = (r) => `${r.a.path}|${r.b.path}`;
  list = [{ ...entry, time: Date.now() }, ...list.filter((r) => key(r) !== key(entry))].slice(0, 12);
  safeWrite('recent', 'recent.json', list);
  for (const f of [entry.a, entry.b]) if (f.path && fs.existsSync(f.path)) app.addRecentDocument(f.path);
  return list;
});
ipcMain.handle('recent-clear', () => { safeWrite('recent', 'recent.json', []); try { app.clearRecentDocuments(); } catch {} return []; });
ipcMain.handle('recent-remove', (_e, idx) => { const l = store.read('recent.json', []); l.splice(idx, 1); safeWrite('recent', 'recent.json', l); return l; });

// 审阅记录（1.7.3）：以前存在渲染进程的 localStorage 里，超过 120 组静默删除最旧的，写失败也不吭声
ipcMain.on('review-get', (e, pk) => { try { e.returnValue = reviews.get(pk); } catch { e.returnValue = null; } });
ipcMain.on('review-index', (e) => { try { e.returnValue = reviews.index(); } catch { e.returnValue = {}; } });
ipcMain.handle('review-save', (_e, pk, data) => {
  try { reviews.save(pk, data); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.on('review-import', (e, all) => {
  try { e.returnValue = { ok: true, n: reviews.importAll(all) }; } catch (err) { e.returnValue = { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('review-usage', () => reviews.usage());
ipcMain.handle('review-clean', (_e, opts) => {
  try { const n = reviews.clean(opts || {}); return { ok: true, n, usage: reviews.usage() }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
});

// 设置（偏好、主题、语言）：同步读、异步写，写失败回报界面
ipcMain.on('settings-get', (e) => { e.returnValue = store.read('settings.json', null); });
let settingsCache = null;
ipcMain.handle('settings-set', (_e, key, value) => {
  if (!settingsCache) settingsCache = store.read('settings.json', {}) || {};
  settingsCache[key] = value;
  try { store.write('settings.json', settingsCache); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('exists', (_e, p) => !!p && fs.existsSync(p));

// 监测文件变化（在 Word 里保存后提示重新比较）
const watchers = new Map();
ipcMain.handle('watch', (e, paths) => {
  for (const [p, w] of watchers) if (!paths.includes(p)) { w.close(); watchers.delete(p); }
  for (const p of paths) {
    if (!p || watchers.has(p) || !fs.existsSync(p)) continue;
    let last = fs.statSync(p).mtimeMs, timer = null;
    const dir = path.dirname(p), base = path.basename(p);
    try {
      // 监听所在目录：Word/WPS 保存时常用“写临时文件再改名”，直接监听文件会丢事件
      const w = fs.watch(dir, (_ev, name) => {
        if (name && name !== base) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          try {
            const m = fs.statSync(p).mtimeMs;
            if (m !== last) { last = m; if (!e.sender.isDestroyed()) e.sender.send('file-changed', p); }
          } catch {}
        }, 700);
      });
      watchers.set(p, w);
    } catch {}
  }
});

// Dock / 任务栏进度、系统通知、剪贴板
ipcMain.on('progress', (_e, v) => { if (mainWin) mainWin.setProgressBar(v < 0 ? -1 : Math.min(1, v)); });
ipcMain.on('notify', (_e, { title, body }) => {
  if (mainWin && mainWin.isFocused()) return;
  if (Notification.isSupported()) new Notification({ title, body, silent: false }).show();
  if (isMac) app.dock.bounce('informational');
});
ipcMain.on('copy-text', (_e, t) => clipboard.writeText(t));

ipcMain.handle('reveal', (_e, p) => shell.showItemInFolder(p));

// ---------- 审阅稿（1.8）：写在对方文件旁边，先写临时文件再改名；绝不覆盖别人改过的文件 ----------
const draftStat = (p) => { try { const s = fs.statSync(p); return { mtime: s.mtimeMs, size: s.size }; } catch { return null; } };
// Word 打开文件时在同一目录放一个 “~$” 开头的占用文件（名字长时替换前两个字符）
function wordLock(p) {
  const dir = path.dirname(p), base = path.basename(p);
  const cands = ['~$' + base, '~$' + base.slice(2), '~$' + base.slice(1)];
  return cands.some((c) => { try { return fs.existsSync(path.join(dir, c)); } catch { return false; } });
}
ipcMain.handle('draft-stat', (_e, p) => (p ? { stat: draftStat(p), locked: wordLock(p) } : null));
ipcMain.handle('draft-save', async (_e, { path: p, data, expect }) => {
  if (!p || !/\.docx$/i.test(p)) return { ok: false, code: 'error', error: 'bad path' };
  const cur = draftStat(p);
  // expect = 上次我们写完后的状态；null = 第一次创建
  if (cur && !expect) return { ok: false, code: 'exists' };
  if (cur && expect && (Math.abs(cur.mtime - expect.mtime) > 1 || cur.size !== expect.size)) return { ok: false, code: 'modified' };
  if (expect && !cur) return { ok: false, code: 'gone' };
  if (cur && wordLock(p)) return { ok: false, code: 'locked' };
  const tmp = path.join(path.dirname(p), `.${path.basename(p)}.${process.pid}.ddtmp`);
  try { await fs.promises.writeFile(tmp, Buffer.from(data)); }
  catch (err) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, code: ['EACCES', 'EPERM', 'EROFS', 'ENOENT'].includes(err.code) ? 'nowrite' : 'error', error: String(err.code || err.message) }; }
  try { await fs.promises.rename(tmp, p); }
  catch (err) { try { fs.unlinkSync(tmp); } catch {} return { ok: false, code: ['EBUSY', 'EPERM', 'EACCES'].includes(err.code) ? 'locked' : 'error', error: String(err.code || err.message) }; }
  return { ok: true, stat: draftStat(p) };
});
// ---------- 模板与往来稿（1.8） ----------
ipcMain.handle('lib-get', () => library.get());
ipcMain.handle('lib-save', (_e, ix, purge) => { try { library.save(ix, !!purge); return { ok: true }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });
ipcMain.handle('lib-put', async (_e, p) => { try { return { ok: true, file: await library.putFile(p) }; } catch (err) { return { ok: false, error: String(err.message || err) }; } });
ipcMain.handle('lib-read', async (_e, { sha, ext, name, orig }) => {
  // 原文件还在、内容没变就读原文件（审阅稿写在它旁边）；否则读库里的拷贝
  if (orig) {
    try {
      const buf = await fs.promises.readFile(orig);
      if (require('crypto').createHash('sha256').update(buf).digest('hex') === sha) return await readDoc(orig);
    } catch {}
  }
  const p = library.pathOf(sha, ext);
  if (!p) return null;
  const f = await readDoc(p);
  return { ...f, name: name || f.name, lib: true };
});
ipcMain.handle('lib-usage', () => library.usage());
ipcMain.handle('lib-rounds', (_e, id) => library.rounds(id));
ipcMain.handle('pick-folder', async (_e, { title, defaultPath } = {}) => {
  const r = await dialog.showOpenDialog(mainWin, { title, defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
// 用系统默认的 PDF 阅读器打开原文件（读取有问题时人工核对，1.7.4）。只允许打开存在的 PDF / DOCX / TXT
ipcMain.handle('open-external-file', async (_e, p) => { if (!p || !fs.existsSync(p) || !EXT_OK.includes(path.extname(p).slice(1).toLowerCase())) return 'not-allowed'; return shell.openPath(p); });

// ---------- 把 DOCX / TXT 渲染成 PDF（用于“图像”和“OCR”模式） ----------
function withHiddenWindow(fn) {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1400,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: false, offscreen: false },
    });
    const done = (err, val) => { try { win.destroy(); } catch {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => done(new Error('渲染超时')), 120000);
    fn(win).then((v) => { clearTimeout(timer); done(null, v); }, (e) => { clearTimeout(timer); done(e); });
  });
}

ipcMain.handle('render-to-pdf', async (_e, job) => {
  return withHiddenWindow(async (win) => {
    const ready = new Promise((resolve, reject) => {
      const onDone = (ev, info) => {
        if (ev.sender !== win.webContents) return;
        ipcMain.removeListener('render-done', onDone);
        info && info.error ? reject(new Error(info.error)) : resolve(info);
      };
      ipcMain.on('render-done', onDone);
    });
    await win.loadURL('app://local/render.html');
    win.webContents.send('render-job', job);
    await ready;
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    return new Uint8Array(pdf.buffer, pdf.byteOffset, pdf.byteLength);
  });
});

// 把一段完整 HTML 打印成 PDF 并保存（修订导出）
ipcMain.handle('html-to-pdf', async (_e, { html, defaultName }) => {
  const tmp = path.join(os.tmpdir(), `docdiff-export-${Date.now()}.html`);
  await fs.promises.writeFile(tmp, html, 'utf8');
  try {
    const pdf = await withHiddenWindow(async (win) => {
      await win.loadFile(tmp);
      await new Promise((r) => setTimeout(r, 300));
      return win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: true });
    });
    const r = await dialog.showSaveDialog(mainWin, { defaultPath: defaultName, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.writeFile(r.filePath, pdf);
    return r.filePath;
  } finally {
    fs.promises.unlink(tmp).catch(() => {});
  }
});

// ---------- OCR（tesseract.js，离线语言包） ----------
let ocrWorker = null;
let ocrLangs = '';
let curPage = 0;
let ocrSender = null;
// tesseract.js 在 Electron 中会把 langPath 当 URL 去下载（离线会卡住）。
// 做法：把随应用打包的语言包预先解压到它的缓存目录，让它直接从本地缓存读取。
async function prepareTessCache(langs) {
  const zlib = require('zlib');
  const dir = path.join(app.getPath('userData'), 'tesscache');
  await fs.promises.mkdir(dir, { recursive: true });
  for (const l of langs) {
    const dst = path.join(dir, `${l}.traineddata`);
    if (fs.existsSync(dst)) continue;
    let src = path.join(path.dirname(require.resolve(`@tesseract.js-data/${l}/package.json`)), '4.0.0_best_int', `${l}.traineddata.gz`);
    src = src.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    const gz = await fs.promises.readFile(src);
    const raw = await new Promise((res, rej) => zlib.gunzip(gz, (e, b) => (e ? rej(e) : res(b))));
    await fs.promises.writeFile(dst + '.tmp', raw);
    await fs.promises.rename(dst + '.tmp', dst);
  }
  return dir;
}

// 取消按“第几次识别”记：渲染端每次开始识别都带一个递增的 run 编号。
// 以前用一个布尔值，下一次 ocr 调用会把它重置成 false，取消就失效了。
let cancelledRun = -1;
ipcMain.handle('ocr-cancel', async (_e, run) => {
  cancelledRun = typeof run === 'number' ? run : Number.MAX_SAFE_INTEGER;
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch {} ocrWorker = null; ocrLangs = ''; }
});

ipcMain.handle('ocr', async (e, { images, langs, run }) => {
  const myRun = typeof run === 'number' ? run : 0;
  const cancelled = () => cancelledRun >= myRun;
  const Tesseract = require('tesseract.js');
  const key = langs.join('+');
  if (!ocrWorker || ocrLangs !== key) {
    if (ocrWorker) await ocrWorker.terminate();
    const cacheDir = await prepareTessCache(langs);
    if (cancelled()) throw new Error('已取消');
    ocrWorker = await Tesseract.createWorker(langs, 1, {
      langPath: 'https://offline.invalid/tessdata', // 不会被访问：语言包已在缓存中
      cachePath: cacheDir,
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text' && ocrSender) ocrSender.send('ocr-progress', { page: curPage, progress: m.progress, run: myRun });
      },
    });
    ocrLangs = key;
  }
  ocrSender = e.sender;
  const out = [];
  for (let i = 0; i < images.length; i++) {
    curPage = i;
    if (cancelled() || !ocrWorker) throw new Error('已取消');
    const { data } = await ocrWorker.recognize(Buffer.from(images[i]), {}, { text: true, blocks: true, hocr: false, tsv: false });
    if (cancelled()) throw new Error('已取消');
    // 每个词的置信度：渲染端据此给没认准的字标虚线
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const l of p.lines || []) for (const w of l.words || []) words.push([w.text, Math.round(w.confidence)]);
    out.push({ text: data.text, conf: typeof data.confidence === 'number' ? data.confidence : -1, words });
    e.sender.send('ocr-progress', { page: i, progress: 1, run: myRun });
  }
  return out;
});

// ---------- 启动 ----------
const pendingPaths = process.argv.slice(app.isPackaged ? 1 : 2).filter((a) => !a.startsWith('-') && fs.existsSync(a) && EXT_OK.includes(path.extname(a).slice(1).toLowerCase()));
app.on('open-file', (e, p) => { e.preventDefault(); if (mainWin) mainWin.webContents.send('open-path', p); else pendingPaths.push(p); });

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
app.on('second-instance', (_e, argv) => {
  if (!mainWin) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
  argv.slice(1).filter((a) => !a.startsWith('-') && fs.existsSync(a) && EXT_OK.includes(path.extname(a).slice(1).toLowerCase())).forEach((p) => mainWin.webContents.send('open-path', p));
});

app.setName('DocDiff');
app.setAboutPanelOptions({
  applicationName: 'DocDiff',
  applicationVersion: app.getVersion(),
  copyright: '© 2026 DocDiff',
  credits: '本地离线文档比对：Word / PDF / TXT',
});

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  buildMenu();
  try {
    const g = app.getGPUFeatureStatus() || {};
    console.log('[DocDiff] platform=%s release=%s titlebar=%s gpu_compositing=%s canvas=%s rasterization=%s',
      process.platform, os.release(), useOverlay ? 'overlay' : 'system',
      g.gpu_compositing, g['2d_canvas'], g.rasterization);
  } catch {}
  // 开发模式（npm start）下 Dock 也显示 DocDiff 图标；打包后由 icon.icns 提供
  if (isMac && !app.isPackaged) { try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {} }
  createWindow();
  ipcMain.handle('initial-paths', () => pendingPaths.splice(0));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// 退出：先立刻退出，OCR worker 的清理不阻塞（Windows 上曾因此残留进程，导致安装程序提示
// “DocDiff cannot be closed”）；3 秒后如果还没退干净就强制结束。
function shutdown() {
  const w = ocrWorker; ocrWorker = null;
  if (w) { try { Promise.resolve(w.terminate()).catch(() => {}); } catch {} }
  for (const win of BrowserWindow.getAllWindows()) { try { win.destroy(); } catch {} }
}
let forcing = false;
function forceExitSoon() {
  if (forcing) return;
  forcing = true;
  const t = setTimeout(() => { try { app.exit(0); } catch {} process.exit(0); }, 3000);
  if (t.unref) t.unref();
}
app.on('window-all-closed', () => {
  shutdown();
  if (!isMac) { app.quit(); forceExitSoon(); }
});
app.on('before-quit', () => { shutdown(); forceExitSoon(); });
