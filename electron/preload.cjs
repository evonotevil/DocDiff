const { contextBridge, ipcRenderer, webUtils } = require('electron');
const os = require('os');
const winBuild = () => { const m = /^\d+\.\d+\.(\d+)/.exec(os.release() || ''); return m ? Number(m[1]) : 0; };
// Win10 用系统标题栏，Win11 / Linux 用按钮覆盖层（与主进程保持一致）
const CHROME = process.platform === 'darwin' ? 'mac' : (process.platform === 'win32' && winBuild() < 22000) ? 'system' : 'overlay';

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  chrome: CHROME,
  chromeInfo: () => ipcRenderer.invoke('chrome-info'),
  openDialog: () => ipcRenderer.invoke('open-dialog'),
  readPath: (p) => ipcRenderer.invoke('read-path', p),
  pathForFile: (f) => { try { return webUtils.getPathForFile(f); } catch { return ''; } },
  saveFile: (opts) => ipcRenderer.invoke('save-file', opts),
  setTheme: (t) => ipcRenderer.send('theme', t),
  setLang: (l) => ipcRenderer.invoke('set-lang', l),
  recentClear: () => ipcRenderer.invoke('recent-clear'),
  recentGet: () => ipcRenderer.invoke('recent-get'),
  recentAdd: (e) => ipcRenderer.invoke('recent-add', e),
  recentRemove: (i) => ipcRenderer.invoke('recent-remove', i),
  exists: (p) => ipcRenderer.invoke('exists', p),
  watch: (paths) => ipcRenderer.invoke('watch', paths),
  onFileChanged: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('file-changed', h); return () => ipcRenderer.removeListener('file-changed', h); },
  setProgress: (v) => ipcRenderer.send('progress', v),
  notify: (title, body) => ipcRenderer.send('notify', { title, body }),
  copyText: (t) => ipcRenderer.send('copy-text', t),
  ocrCancel: () => ipcRenderer.invoke('ocr-cancel'),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  renderToPdf: (job) => ipcRenderer.invoke('render-to-pdf', job),
  htmlToPdf: (opts) => ipcRenderer.invoke('html-to-pdf', opts),
  ocr: (opts) => ipcRenderer.invoke('ocr', opts),
  initialPaths: () => ipcRenderer.invoke('initial-paths'),
  onOcrProgress: (cb) => { const h = (_e, d) => cb(d); ipcRenderer.on('ocr-progress', h); return () => ipcRenderer.removeListener('ocr-progress', h); },
  onMenu: (cb) => { const h = (_e, ...a) => cb(...a); ipcRenderer.on('menu', h); return () => ipcRenderer.removeListener('menu', h); },
  onOpenPath: (cb) => { const h = (_e, p) => cb(p); ipcRenderer.on('open-path', h); return () => ipcRenderer.removeListener('open-path', h); },
  // 渲染窗口专用
  onRenderJob: (cb) => ipcRenderer.on('render-job', (_e, job) => cb(job)),
  renderDone: (info) => ipcRenderer.send('render-done', info),
});
