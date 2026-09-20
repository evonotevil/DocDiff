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

// ---------- 平台差异集中在这里（Windows 适配预埋） ----------
const PLATFORM = {
  isMac,
  isWin: process.platform === 'win32',
  // macOS 用隐藏标题栏 + 红绿灯；Windows/Linux 用隐藏标题栏 + 系统按钮覆盖层
  windowChrome: (dark) => isMac
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 18, y: 18 } }
    : { titleBarStyle: 'hidden', titleBarOverlay: overlayFor(dark) },
};

// ---------- 持久化：窗口位置 / 最近比较 ----------
const store = {
  file: (n) => path.join(app.getPath('userData'), n),
  read(n, def) { try { return JSON.parse(fs.readFileSync(this.file(n), 'utf8')); } catch { return def; } },
  write(n, v) { try { fs.writeFileSync(this.file(n), JSON.stringify(v, null, 2)); } catch {} },
};
function restoreBounds() {
  const b = store.read('window.json', null);
  if (!b) return { width: 1440, height: 920 };
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x >= a.x - 50 && b.y >= a.y - 50 && b.x < a.x + a.width - 100 && b.y < a.y + a.height - 100;
  });
  return visible ? b : { width: b.width || 1440, height: b.height || 920 };
}
const overlayFor = (dark) => ({ color: dark ? '#131f24' : '#ffffff', symbolColor: dark ? '#f1f7fb' : '#4b4b4b', height: 52 });

function createWindow() {
  const bounds = restoreBounds();
  mainWin = new BrowserWindow({
    ...bounds,
    minWidth: 1100,
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
  const saveBounds = () => { if (!mainWin || mainWin.isDestroyed()) return; store.write('window.json', { ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() }); };
  mainWin.on('close', saveBounds);
  mainWin.on('closed', () => { mainWin = null; });
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
      label: '文件',
      submenu: [
        { label: '打开原始文档…', accelerator: 'CmdOrCtrl+O', click: () => send('menu', 'open-left') },
        { label: '打开修改后文档…', accelerator: 'CmdOrCtrl+Shift+O', click: () => send('menu', 'open-right') },
        { type: 'separator' },
        { label: '交换左右', accelerator: 'CmdOrCtrl+Shift+S', click: () => send('menu', 'swap') },
        { label: '新建比较', accelerator: 'CmdOrCtrl+N', click: () => send('menu', 'clear') },
        { type: 'separator' },
        isMac ? { role: 'close', label: '关闭窗口' } : { role: 'quit', label: '退出' },
      ],
    },
    { role: 'editMenu', label: '编辑' },
    {
      label: '视图',
      submenu: [
        ...['富文本', '纯文本', '修订审阅', '图像', 'OCR 文本', '文件详情'].map((l, i) => ({
          label: l, accelerator: `CmdOrCtrl+${i + 1}`, click: () => send('menu', 'tab', i),
        })),
        { type: 'separator' },
        { label: '下一处差异（J）', accelerator: 'F7', click: () => send('menu', 'next') },
        { label: '上一处差异（K）', accelerator: 'Shift+F7', click: () => send('menu', 'prev') },
        { type: 'separator' },
        ...(app.isPackaged ? [] : [{ role: 'reload', label: '重新加载' }, { role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }]),
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
      ],
    },
    { role: 'windowMenu', label: '窗口' },
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
      { name: '文档', extensions: ['docx', 'pdf', 'txt', 'md'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return readDoc(r.filePaths[0]);
});

ipcMain.handle('read-path', async (_e, p) => readDoc(p));

ipcMain.handle('save-file', async (_e, { defaultName, data, filters }) => {
  const r = await dialog.showSaveDialog(mainWin, { defaultPath: defaultName, filters });
  if (r.canceled || !r.filePath) return null;
  await fs.promises.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.on('theme', (_e, t) => {
  nativeTheme.themeSource = t;
  if (!isMac && mainWin) { try { mainWin.setTitleBarOverlay(overlayFor(t === 'dark')); } catch {} }
});

// 最近比较
ipcMain.handle('recent-get', () => store.read('recent.json', []).filter((r) => r.a && r.b));
ipcMain.handle('recent-add', (_e, entry) => {
  let list = store.read('recent.json', []);
  const key = (r) => `${r.a.path}|${r.b.path}`;
  list = [{ ...entry, time: Date.now() }, ...list.filter((r) => key(r) !== key(entry))].slice(0, 12);
  store.write('recent.json', list);
  for (const f of [entry.a, entry.b]) if (f.path && fs.existsSync(f.path)) app.addRecentDocument(f.path);
  return list;
});
ipcMain.handle('recent-remove', (_e, idx) => { const l = store.read('recent.json', []); l.splice(idx, 1); store.write('recent.json', l); return l; });
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

let ocrCancelled = false;
ipcMain.handle('ocr-cancel', async () => {
  ocrCancelled = true;
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch {} ocrWorker = null; ocrLangs = ''; }
});

ipcMain.handle('ocr', async (e, { images, langs }) => {
  ocrCancelled = false;
  const Tesseract = require('tesseract.js');
  const key = langs.join('+');
  if (!ocrWorker || ocrLangs !== key) {
    if (ocrWorker) await ocrWorker.terminate();
    const cacheDir = await prepareTessCache(langs);
    ocrWorker = await Tesseract.createWorker(langs, 1, {
      langPath: 'https://offline.invalid/tessdata', // 不会被访问：语言包已在缓存中
      cachePath: cacheDir,
      gzip: true,
      logger: (m) => {
        if (m.status === 'recognizing text' && ocrSender) ocrSender.send('ocr-progress', { page: curPage, progress: m.progress });
      },
    });
    ocrLangs = key;
  }
  ocrSender = e.sender;
  const out = [];
  for (let i = 0; i < images.length; i++) {
    curPage = i;
    if (ocrCancelled || !ocrWorker) throw new Error('已取消');
    const { data } = await ocrWorker.recognize(Buffer.from(images[i]));
    out.push(data.text);
    e.sender.send('ocr-progress', { page: i, progress: 1 });
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
  // 开发模式（npm start）下 Dock 也显示 DocDiff 图标；打包后由 icon.icns 提供
  if (isMac && !app.isPackaged) { try { app.dock.setIcon(path.join(__dirname, '..', 'build', 'icon.png')); } catch {} }
  createWindow();
  ipcMain.handle('initial-paths', () => pendingPaths.splice(0));
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', async () => {
  if (ocrWorker) { try { await ocrWorker.terminate(); } catch {} }
  if (!isMac) app.quit();
});
