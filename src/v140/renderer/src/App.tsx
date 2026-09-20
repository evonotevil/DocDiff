import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocModel, FileInfo } from './lib/model';
import { docPlainText, fmtBytes } from './lib/model';
import { loadDoc } from './lib/load';
import { NeedPassword } from './lib/pdf';
import { diffDocs, linesToBlocks, DiffOptions, DiffResult, Change } from './lib/engine';
import { buildDocx } from './lib/exportDocx';
import { getPages } from './lib/pages';
import { isMac, kbd, modPressed } from './lib/platform';
import { t, setLang, initLang, Lang } from './lib/i18n';
import { ChangeList, KIND_LABEL, changesMarkdown, short } from './components/ChangeList';
import { ChangeMap } from './components/ChangeMap';
import { Mascot, Confetti } from './components/Mascot';
import { Wordmark } from './components/Logo';
import { Switch, Opt, Seg, Card, Kbd } from './components/ui';
import * as I from './components/icons';
import { RichView } from './views/RichView';
import { PlainView } from './views/PlainView';
import { RedlineView } from './views/RedlineView';
import { ImageView, ImgMode, useImagePages } from './views/ImageView';
import { DetailsView } from './views/DetailsView';

const api = (window as any).api;
const APP_VERSION = 'v1.4';
type Side = 0 | 1;
const sideLabel = (s: Side) => t(s ? '修改后文档' : '原始文档');
const MODES = [
  { label: '富文本', icon: <I.ModeRich /> },
  { label: '纯文本', icon: <I.ModePlain /> },
  { label: '修订审阅', icon: <I.ModeRedline /> },
  { label: '图像', icon: <I.ModeImage /> },
  { label: 'OCR 文本', icon: <I.ModeOcr /> },
  { label: '文件详情', icon: <I.ModeDetails /> },
];

// ---------- 设置持久化 ----------
interface Prefs {
  ignoreCase: boolean; ignoreWs: boolean; precision: 'word' | 'char'; detectMoves: boolean; normPunct: boolean;
  hideRich: boolean; hidePlain: boolean; layout: 'split' | 'unified'; wrap: boolean;
  imgMode: ImgMode; threshold: number; showBoxes: boolean; ocrLang: OcrLang; sound: boolean;
  navOpen: boolean; asideOpen: boolean;
}
const DEFAULT_PREFS: Prefs = {
  ignoreCase: false, ignoreWs: true, precision: 'word', detectMoves: true, normPunct: false,
  hideRich: false, hidePlain: false, layout: 'split', wrap: true,
  imgMode: 'split', threshold: 0.1, showBoxes: true, ocrLang: 'chi_sim+eng', sound: true,
  navOpen: true, asideOpen: true,
};
function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('prefs-v2') || '{}') }; } catch { return DEFAULT_PREFS; }
}

// ---------- 音效（很轻的提示音，可在设置里关闭） ----------
let actx: AudioContext | null = null;
function chime(kind: 'ok' | 'no' | 'done') {
  try {
    actx ||= new AudioContext();
    const notes = kind === 'ok' ? [880, 1320] : kind === 'no' ? [330, 262] : [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      const o = actx!.createOscillator(), g = actx!.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t = actx!.currentTime + i * 0.09;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.12, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g).connect(actx!.destination); o.start(t); o.stop(t + 0.25);
    });
  } catch {}
}

// ---------- 拖放 ----------
async function filesFromDrop(e: React.DragEvent): Promise<FileInfo[]> {
  const out: FileInfo[] = [];
  for (const f of Array.from(e.dataTransfer.files)) {
    const p = api.pathForFile(f);
    if (p) out.push(await api.readPath(p));
    else out.push({ path: '', name: f.name, ext: f.name.split('.').pop()!.toLowerCase(), size: f.size, mtime: f.lastModified, birthtime: f.lastModified, data: new Uint8Array(await f.arrayBuffer()) });
  }
  return out;
}
function useDrop(onFiles: (f: FileInfo[]) => void) {
  const [over, setOver] = useState(false);
  return {
    over,
    props: {
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(true); },
      onDragLeave: () => setOver(false),
      onDrop: async (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setOver(false); onFiles(await filesFromDrop(e)); },
    },
  };
}
function textFile(text: string, side: Side): FileInfo {
  const data = new TextEncoder().encode(text);
  const now = Date.now();
  return { path: '', name: t(side ? '粘贴的文字（修改后）.txt' : '粘贴的文字（原始）.txt'), ext: 'txt', size: data.length, mtime: now, birthtime: now, data };
}
const docStat = (d: DocModel) => `${d.type.toUpperCase()} · ${fmtBytes(d.file.size)}${d.pageCount ? ` · ${t('{n} 页', { n: d.pageCount })}` : ''}`;

function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('刚刚');
  if (s < 3600) return t('{n} 分钟前', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} 小时前', { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t('{n} 天前', { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString();
}

// ---------- 首页组件 ----------
function DropZone({ side, doc, loading, error, onOpen, onFiles, onClear, onPaste }: {
  side: Side; doc: DocModel | null; loading: boolean; error: string | null;
  onOpen: () => void; onFiles: (f: FileInfo[]) => void; onClear: () => void; onPaste: () => void;
}) {
  const d = useDrop(onFiles);
  return (
    <div className={`drop ${d.over ? 'over' : ''} ${doc ? 'filled' : ''}`} {...d.props}>
      <div className="label">{sideLabel(side)}</div>
      {loading ? (<><div className="spinner" /><div className="hint">{t('正在读取…')}</div></>) : doc ? (
        <>
          <I.FileGlyph type={doc.type} size={64} />
          <div className="name">{doc.file.name}</div>
          <div className="sub">{docStat(doc)} · {t('{n} 段', { n: doc.blocks.filter((b) => b.kind === 'tr' || b.runs.length).length })}</div>
          {doc.type === 'pdf' && doc.blocks.length === 0 && <div className="err">{t('没读到文字，可能是扫描件。比较后用「OCR 文本」或「图像」模式。')}</div>}
          <div className="acts"><button className="btn sm" onClick={onOpen}><I.IconUpload />{t('更换')}</button><button className="btn sm plain" onClick={onClear}>{t('移除')}</button></div>
        </>
      ) : (
        <>
          <div style={{ opacity: .55 }}><I.FileGlyph type="txt" size={60} /></div>
          <div className="title">{t('拖入{s}', { s: sideLabel(side) })}</div>
          <div className="hint">{t('支持 Word（.docx）、PDF、TXT')}</div>
          <div className="acts">
            <button className="btn blue" onClick={onOpen}><I.IconUpload />{t('选择文件')}</button>
            <button className="btn" onClick={onPaste}><I.IconPaste />{t('粘贴文字')}</button>
          </div>
        </>
      )}
      {error && <div className="err">{error}</div>}
    </div>
  );
}

function FilePill({ side, doc, onOpen, onFiles, changed }: { side: Side; doc: DocModel; onOpen: () => void; onFiles: (f: FileInfo[]) => void; changed: boolean }) {
  const d = useDrop(onFiles);
  return (
    <div className={`filepill ${d.over ? 'over' : ''}`} {...d.props} title={doc.file.path || doc.file.name}>
      <I.FileGlyph type={doc.type} size={32} />
      <div className="grow">
        <span className="who">{sideLabel(side)}{changed ? ` · ${t('已更新')}` : ''}</span>
        <span className="name">{doc.file.name}</span>
      </div>
      <button className="btn sm plain icon" onClick={onOpen} title={t('换一个文件（也可以直接拖进来）')}><I.IconUpload /></button>
    </div>
  );
}

function PasswordModal({ name, wrong, onOk, onCancel }: { name: string; wrong: boolean; onOk: (p: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{t('这个 PDF 有密码')}</h3>
        <p>{t('「{f}」受密码保护。', { f: name })}{wrong && <b style={{ color: 'var(--cardinal)' }}>{t('密码不对，再试一次。')}</b>}</p>
        <input type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(v)} placeholder={t('输入密码')} />
        <div className="acts"><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" onClick={() => onOk(v)}>{t('打开')}</button></div>
      </div>
    </div>
  );
}

function PasteModal({ side, onOk, onCancel }: { side: Side; onOk: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <div className="modal-bg" onClick={onCancel}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>{t('粘贴{s}的文字', { s: sideLabel(side) })}</h3>
        <p>{t('直接粘贴从网页、邮件、聊天软件里复制的内容。')}</p>
        <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('在这里粘贴…（{k}）', { k: kbd('mod+V') })} />
        <div className="acts"><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" disabled={!v.trim()} onClick={() => onOk(v)}>{t('使用这段文字')}</button></div>
      </div>
    </div>
  );
}

function ShortcutRows() {
  const rows: [string, string][] = [
    [kbd('mod+O'), t('打开原始文档')], [kbd('mod+shift+O'), t('打开修改后文档')], [kbd('mod+N'), t('新建比较')],
    [`${kbd('mod+1')} … ${kbd('mod+6')}`, t('切换模式')], ['J / K', t('下一处 / 上一处差异')],
    ['A / R', t('（修订审阅）接受 / 拒绝')], ['U', t('（修订审阅）撤销当前决定')], [kbd('mod+shift+S'), t('交换左右文档')],
    ['Enter', t('（首页）开始比较')],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map(([k, l]) => <div key={l} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontWeight: 700 }}><span>{l}</span><Kbd>{k}</Kbd></div>)}
    </div>
  );
}

function SettingsModal({ lang, setLang, theme, setTheme, sound, setSound, onClose }: {
  lang: Lang; setLang: (l: Lang) => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void;
  sound: boolean; setSound: (v: boolean) => void; onClose: () => void;
}) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide settings-modal" onClick={(e) => e.stopPropagation()}>
        <h3><I.IconGear />{t('设置')}</h3>
        <div className="set-sect">
          <Opt label={t('语言 / Language')}><Seg value={lang} options={[['zh', '中文'], ['en', 'English']]} onChange={(v) => setLang(v as Lang)} /></Opt>
          <Opt label={t('外观')}><Seg value={theme} options={[['light', t('浅色')], ['dark', t('深色')]]} onChange={(v) => setTheme(v as 'light' | 'dark')} /></Opt>
          <Opt label={t('音效')} hint={t('审阅修订时的轻提示音')}><Switch on={sound} onChange={setSound} /></Opt>
        </div>
        <div className="set-sect">
          <div className="set-title"><I.IconKeyboard />{t('快捷键')}</div>
          <ShortcutRows />
        </div>
        <div className="set-about">DocDiff {APP_VERSION} · {t('完全离线，文件不会离开这台电脑')}</div>
        <div className="acts"><button className="btn primary" onClick={onClose}>{t('完成')}</button></div>
      </div>
    </div>
  );
}

// ---------- OCR ----------
type OcrLang = 'chi_sim+eng' | 'eng' | 'chi_sim';
interface OcrState { status: 'idle' | 'running' | 'done' | 'error'; msg?: string; pct?: number; a?: string; b?: string; key?: string }
function cleanOcr(t: string) {
  return t
    .replace(/([　-〿㐀-鿿＀-￯])[ \t]+(?=[　-〿㐀-鿿＀-￯])/g, '$1')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// =========================================================
export default function App() {
  const [docs, setDocs] = useState<[DocModel | null, DocModel | null]>([null, null]);
  const [busy, setBusy] = useState<[boolean, boolean]>([false, false]);
  const [errs, setErrs] = useState<[string | null, string | null]>([null, null]);
  const [pwd, setPwd] = useState<{ side: Side; file: FileInfo; wrong: boolean } | null>(null);
  const [pasteSide, setPasteSide] = useState<Side | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [lang, setLangState] = useState<Lang>(initLang);
  const [compared, setCompared] = useState(false);
  const [tab, setTab] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try { const t = localStorage.getItem('theme'); if (t === 'light' || t === 'dark') return t; } catch {}
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [toast, setToast] = useState<string | null>(null);
  const changeLang = (l: Lang) => { setLang(l); setLangState(l); api.setLang?.(l); };
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [formatting, setFormatting] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [recent, setRecent] = useState<any[]>([]);
  const [changedSides, setChangedSides] = useState<Side[]>([]);
  const [selCid, setSelCid] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<Record<number, 'a' | 'r'>>({});
  const [feedback, setFeedback] = useState<'ok' | 'no' | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [fade, setFade] = useState(50);
  const [slider, setSlider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [onlyDiffPages, setOnlyDiffPages] = useState(false);
  const [ocr, setOcr] = useState<OcrState>({ status: 'idle' });
  const imgScroll = useRef<HTMLDivElement>(null);
  const redlineRef = useRef<HTMLDivElement>(null);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('theme', theme); } catch {} api.setTheme?.(theme); }, [theme]);
  useEffect(() => { try { localStorage.setItem('prefs-v2', JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => { api.setLang?.(lang); }, []);
  useEffect(() => { api.recentGet?.().then(setRecent); }, [compared]);
  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  const [A, B] = docs;
  const setSide = <T,>(arr: [T, T], side: Side, v: T): [T, T] => (side === 0 ? [v, arr[1]] : [arr[0], v]);

  const loadFile = useCallback(async (side: Side, f: FileInfo, password?: string) => {
    setBusy((b) => setSide(b, side, true));
    setErrs((e) => setSide(e, side, null));
    try {
      const d = await loadDoc(f, password);
      setDocs((ds) => setSide(ds, side, d));
    } catch (e: any) {
      if (e instanceof NeedPassword) setPwd({ side, file: f, wrong: e.wrong });
      else setErrs((er) => setSide(er, side, String(e?.message || e)));
    } finally {
      setBusy((b) => setSide(b, side, false));
    }
  }, []);
  const open = useCallback(async (side: Side) => { const f = await api.openDialog(); if (f) loadFile(side, f); }, [loadFile]);
  const onFiles = useCallback((side: Side, fs: FileInfo[]) => {
    if (!fs.length) return;
    if (fs.length >= 2) { loadFile(0, fs[0]); loadFile(1, fs[1]); return; }
    loadFile(side, fs[0]);
  }, [loadFile]);

  useEffect(() => { if (A && B) setFormatting(A.type === B.type && A.type !== 'txt'); }, [A?.type, B?.type]);

  // 命令行 / Finder 打开
  useEffect(() => {
    api.initialPaths().then(async (ps: string[]) => {
      for (let i = 0; i < Math.min(2, ps.length); i++) await loadFile(i as Side, await api.readPath(ps[i]));
      if (ps.length >= 2) setCompared(true);
    });
    return api.onOpenPath(async (p: string) => {
      const f = await api.readPath(p);
      setDocs((ds) => { loadFile(!ds[0] ? 0 : 1, f); return ds; });
    });
  }, [loadFile]);

  useEffect(() => {
    const prevent = (e: DragEvent) => e.preventDefault();
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => { window.removeEventListener('dragover', prevent); window.removeEventListener('drop', prevent); };
  }, []);

  // 记录最近比较 + 监测文件变化
  useEffect(() => {
    if (!compared || !A || !B) return;
    if (A.file.path && B.file.path) {
      const f = (d: DocModel) => ({ path: d.file.path, name: d.file.name, ext: d.type });
      api.recentAdd?.({ a: f(A), b: f(B) });
    }
    api.watch?.([A.file.path, B.file.path].filter(Boolean));
  }, [compared, A?.file.path, B?.file.path]);
  useEffect(() => api.onFileChanged?.((p: string) => {
    setDocs((ds) => {
      const sides = ([0, 1] as Side[]).filter((s) => ds[s]?.file.path === p);
      if (sides.length) setChangedSides((c) => [...new Set([...c, ...sides])]);
      return ds;
    });
  }), []);
  const reloadChanged = async () => {
    for (const s of changedSides) { const d = docs[s]; if (d?.file.path) await loadFile(s, await api.readPath(d.file.path)); }
    setChangedSides([]);
    flash(t('已按最新文件重新比较'));
  };
  useEffect(() => { if (!compared) api.watch?.([]); }, [compared]);

  // ---------- 比较 ----------
  const opts: DiffOptions = { ignoreCase: prefs.ignoreCase, ignoreWhitespace: prefs.ignoreWs, precision: prefs.precision, formatting, detectMoves: prefs.detectMoves, normPunct: prefs.normPunct };
  const optKey = JSON.stringify(opts);
  const richRes = useMemo(() => (compared && A && B ? diffDocs(A.blocks, B.blocks, { ...opts, mergeParas: true }) : null), [compared, A, B, optKey, lang]);
  const plainBlocks = useMemo(() => (A && B ? [linesToBlocks(docPlainText(A)), linesToBlocks(docPlainText(B))] : null), [A, B]);
  const plainRes = useMemo(() => (compared && plainBlocks ? diffDocs(plainBlocks[0], plainBlocks[1], { ...opts, formatting: false, keepEmpty: true }) : null), [compared, plainBlocks, optKey, lang]);
  const ocrKey = A && B ? `${A.sha256}|${B.sha256}|${prefs.ocrLang}` : '';
  const ocrBlocks = useMemo(() => (ocr.status === 'done' && ocr.key === ocrKey ? [linesToBlocks(ocr.a!), linesToBlocks(ocr.b!)] : null), [ocr, ocrKey]);
  const ocrRes = useMemo(() => (ocrBlocks ? diffDocs(ocrBlocks[0], ocrBlocks[1], { ...opts, formatting: false, keepEmpty: true }) : null), [ocrBlocks, optKey, lang]);
  const imgState = useImagePages(tab === 3 && compared && A && B ? A : (null as any), tab === 3 && compared && A && B ? B : (null as any), prefs.threshold);

  useEffect(() => { setDecisions({}); setDoneOpen(false); }, [richRes]);
  useEffect(() => setSelCid(null), [tab, richRes, plainRes, ocrRes]);

  const curRes: DiffResult | null = tab === 0 || tab === 2 ? richRes : tab === 1 ? plainRes : tab === 4 ? ocrRes : null;
  const changes: Change[] = curRes?.changes || [];

  const go = useCallback((d: number) => {
    if (!changes.length) return;
    const idx = changes.findIndex((c) => c.id === selCid);
    const n = idx < 0 ? (d > 0 ? 0 : changes.length - 1) : Math.min(changes.length - 1, Math.max(0, idx + d));
    setSelCid(changes[n].id);
  }, [changes, selCid]);

  // ---------- 修订审阅 ----------
  const decidedCount = changes.filter((c) => decisions[c.id]).length;
  const nextUndecided = (after: number | null, dec: Record<number, string>) => {
    const idx = changes.findIndex((c) => c.id === after);
    return changes.slice(idx + 1).find((c) => !dec[c.id]) || changes.find((c) => !dec[c.id]);
  };
  useEffect(() => { if (tab === 2 && selCid == null && changes.length) setSelCid((nextUndecided(null, decisions) || changes[0]).id); }, [tab, changes, selCid]);
  const decide = (cid: number | null, v: 'a' | 'r' | null) => {
    if (cid == null) return;
    const next = { ...decisions };
    if (v) next[cid] = v; else delete next[cid];
    setDecisions(next);
    if (!v) return;
    setFeedback(v === 'a' ? 'ok' : 'no');
    if (prefs.sound) chime(v === 'a' ? 'ok' : 'no');
    setTimeout(() => setFeedback(null), 650);
    const all = changes.every((c) => next[c.id]);
    if (all && changes.length) {
      setTimeout(() => { setDoneOpen(true); if (prefs.sound) chime('done'); }, 450);
    } else {
      const n = nextUndecided(cid, next);
      if (n) setTimeout(() => setSelCid(n.id), 220);
    }
  };
  const decideAll = (v: 'a' | 'r' | null) => {
    setDecisions(v ? Object.fromEntries(changes.map((c) => [c.id, v])) : {});
    if (v && changes.length) { setDoneOpen(true); if (prefs.sound) chime('done'); }
  };
  const baseName = B ? B.file.name.replace(/\.[^.]+$/, '') : 'document';
  const exportDocx = async (finalMode: boolean) => {
    if (!richRes || !A || !B) return;
    const bytes = await buildDocx(richRes.rows, A.blocks, B.blocks, (cid) => (cid === undefined ? undefined : decisions[cid]), finalMode, baseName);
    const p = await api.saveFile({ defaultName: `${baseName}-${t(finalMode ? '最终稿' : '修订稿')}.docx`, data: bytes, filters: [{ name: t('Word 文档'), extensions: ['docx'] }] });
    if (p) flash(t('已导出：{p}', { p }));
  };
  const exportPdf = async () => {
    if (!redlineRef.current) return;
    const css = Array.from(document.styleSheets).map((s) => { try { return Array.from(s.cssRules).map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const clone = redlineRef.current.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.sel-cid, .sel-row').forEach((e) => e.classList.remove('sel-cid', 'sel-row'));
    const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${css}
      @page { size: A4; margin: 18mm 16mm; }
      html, body { overflow: visible !important; height: auto !important; background: #fff !important; user-select: text; }
      .redline { box-shadow: none !important; padding: 0 !important; max-width: none !important; border-radius: 0 !important; }
      .redline > div { content-visibility: visible !important; }
      .head-note { font: 11px -apple-system, "PingFang SC", sans-serif; color: #666; margin-bottom: 18px; border-bottom: 1px solid #ddd; padding-bottom: 8px; }
    </style></head><body><div class="head-note">${t('修订对比')}：${A!.file.name} → ${B!.file.name}　·　${t('红色删除线 = 删除，绿色下划线 = 新增，紫色 = 移动，橙色底线 = 格式变化')}</div>${clone.outerHTML}</body></html>`;
    const p = await api.htmlToPdf({ html, defaultName: `${baseName}-${t('修订对比')}.pdf` });
    if (p) flash(t('已导出：{p}', { p }));
  };
  const copySummary = () => {
    if (!curRes || !A || !B) return;
    api.copyText(changesMarkdown(curRes.changes, A.file.name, B.file.name, curRes.stats));
    flash(t('已复制 {n} 处差异的摘要，可以直接粘贴', { n: curRes.changes.length }));
  };

  // ---------- OCR ----------
  const runOcr = async () => {
    if (!A || !B) return;
    const key = ocrKey;
    const langs = prefs.ocrLang.split('+');
    setOcr({ status: 'running', msg: t('正在准备页面…'), pct: 0, key });
    let off: (() => void) | null = null;
    try {
      const texts: string[] = [];
      for (const [si, d] of [[0, A], [1, B]] as [number, DocModel][]) {
        const pages = await getPages(d, 2, (i, n) => setOcr((o) => ({ ...o, msg: t('正在准备{s}的第 {i}/{n} 页', { s: sideLabel(si as Side), i, n }) })));
        const imgs: Uint8Array[] = [];
        for (const p of pages) {
          const blob: Blob = await new Promise((r) => p.canvas.toBlob((b) => r(b!), 'image/png'));
          imgs.push(new Uint8Array(await blob.arrayBuffer()));
        }
        off?.();
        off = api.onOcrProgress(({ page, progress }: any) => {
          const total = pages.length;
          const pct = ((si * total + page + progress) / (2 * total)) * 100;
          api.setProgress?.(pct / 100);
          setOcr((o) => (o.status === 'running' ? { ...o, pct, msg: t('正在识别{s}：第 {i}/{n} 页', { s: sideLabel(si as Side), i: page + 1, n: total }) } : o));
        });
        setOcr((o) => ({ ...o, msg: t('正在加载识别模型…') }));
        const res: string[] = await api.ocr({ images: imgs, langs });
        texts.push(res.map((x, i) => (res.length > 1 ? `—— ${t('第 {n} 页', { n: i + 1 })} ——\n` : '') + cleanOcr(x)).join('\n\n'));
      }
      setOcr({ status: 'done', a: texts[0], b: texts[1], key });
      api.notify?.(t('OCR 识别完成'), t('{a} 与 {b} 已可以比较', { a: A.file.name, b: B.file.name }));
      if (prefs.sound) chime('done');
    } catch (e: any) {
      const m = String(e?.message || e);
      setOcr(/取消/.test(m) ? { status: 'idle' } : { status: 'error', msg: m, key });
    } finally { off?.(); api.setProgress?.(-1); }
  };
  const cancelOcr = () => { api.ocrCancel?.(); setOcr({ status: 'idle' }); flash(t('已取消识别')); };

  // ---------- 菜单 & 键盘 ----------
  const canCompare = !!(A && B) && !busy[0] && !busy[1];
  const startCompare = () => { if (canCompare) { setCompared(true); setTab(0); setChangedSides([]); } };
  const clearAll = () => { setDocs([null, null]); setCompared(false); setErrs([null, null]); setOcr({ status: 'idle' }); setChangedSides([]); };
  const swap = () => { setDocs(([a, b]) => [b, a]); setOcr({ status: 'idle' }); };
  const actions = useRef<any>({});
  actions.current = { open, swap, clearAll, go, decide, setTab, startCompare, compared, tab, selCid, decisions, modal: !!(pwd || pasteSide !== null || showSettings) };
  useEffect(() => api.onMenu((cmd: string, arg?: any) => {
    const a = actions.current;
    if (cmd === 'open-left') a.open(0);
    else if (cmd === 'open-right') a.open(1);
    else if (cmd === 'swap') a.swap();
    else if (cmd === 'clear') a.clearAll();
    else if (cmd === 'tab' && a.compared) a.setTab(arg);
    else if (cmd === 'next') a.go(1);
    else if (cmd === 'prev') a.go(-1);
  }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      const t = e.target as HTMLElement;
      if (a.modal || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || modPressed(e) || e.altKey) return;
      if (!a.compared) { if (e.key === 'Enter') a.startCompare(); return; }
      const k = e.key.toLowerCase();
      if (k === 'j') { a.go(1); e.preventDefault(); }
      else if (k === 'k') { a.go(-1); e.preventDefault(); }
      else if (a.tab === 2) {
        if (k === 'a' || k === 'y') a.decide(a.selCid, 'a');
        else if (k === 'r' || k === 'n') a.decide(a.selCid, 'r');
        else if (k === 'u') a.decide(a.selCid, null);
        else if (e.key === 'ArrowRight') a.go(1);
        else if (e.key === 'ArrowLeft') a.go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const modals = (
    <>
      {pwd && <PasswordModal name={pwd.file.name} wrong={pwd.wrong} onCancel={() => setPwd(null)} onOk={(p) => { const x = pwd; setPwd(null); loadFile(x.side, x.file, p); }} />}
      {pasteSide !== null && <PasteModal side={pasteSide} onCancel={() => setPasteSide(null)} onOk={(t) => { const s = pasteSide; setPasteSide(null); loadFile(s, textFile(t, s)); }} />}
      {showSettings && <SettingsModal lang={lang} setLang={changeLang} theme={theme} setTheme={setTheme} sound={prefs.sound} setSound={set('sound')} onClose={() => setShowSettings(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </>
  );

  // =================== 首页 ===================
  if (!compared || !A || !B) {
    const openRecent = async (r: any) => {
      const ok = await Promise.all([api.exists(r.a.path), api.exists(r.b.path)]);
      if (!ok[0] || !ok[1]) { flash(t('找不到「{f}」，它可能被移动或删除了', { f: !ok[0] ? r.a.name : r.b.name })); return; }
      await Promise.all([loadFile(0, await api.readPath(r.a.path)), loadFile(1, await api.readPath(r.b.path))]);
      setCompared(true); setTab(0);
    };
    return (
      <div className="app home">
        <div className="home-top drag">
          <Wordmark size={36} sub={t('离线文档比对')} />
          <div className="spacer" />
          <button className="btn plain icon" title={t('设置')} onClick={() => setShowSettings(true)}><I.IconGear /></button>
        </div>
        <div className="home-scroll">
          <div className="home-inner">
            <div className="hero">
              <Mascot mood={A && B ? 'cheer' : A || B ? 'happy' : 'think'} size={132} className="mascot-bob" />
              <div>
                <h1>{t(A && B ? '准备好了！按「开始比较」吧' : '找出两份文档的每一处不同')}</h1>
                <p>{t('Word、PDF、TXT 任意组合 · 所有处理都在这台电脑上完成，不会上传')}</p>
                <div className="pills">
                  {MODES.map((m) => <span key={m.label} className="pill">{m.icon}{t(m.label)}</span>)}
                </div>
              </div>
            </div>
            <div className="drops">
              <DropZone side={0} doc={A} loading={busy[0]} error={errs[0]} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} onClear={() => setDocs((d) => [null, d[1]])} onPaste={() => setPasteSide(0)} />
              <div className="vs"><button className="vs-chip" title={t('交换左右')} onClick={swap}><I.IconSwap /></button></div>
              <DropZone side={1} doc={B} loading={busy[1]} error={errs[1]} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} onClear={() => setDocs((d) => [d[0], null])} onPaste={() => setPasteSide(1)} />
            </div>
            {recent.length > 0 && (
              <div className="recent">
                <h2><I.IconClock />{t('最近比较')}</h2>
                <div className="recent-grid">
                  {recent.map((r, i) => (
                    <div key={i} className="recent-item" role="button" tabIndex={0} onClick={() => openRecent(r)} onKeyDown={(e) => e.key === 'Enter' && openRecent(r)}>
                      <div className="row"><span className={`badge ${r.a.ext}`}>{r.a.ext.toUpperCase()}</span><span>{r.a.name}</span></div>
                      <div className="row"><span className={`badge ${r.b.ext}`}>{r.b.ext.toUpperCase()}</span><span>{r.b.name}</span></div>
                      <div className="time">{timeAgo(r.time)}</div>
                      <button className="btn sm plain icon x" title={t('从列表移除')} onClick={(e) => { e.stopPropagation(); api.recentRemove(i).then(setRecent); }}><I.IconX /></button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="home-cta">
            {canCompare && <span className="hint">{t('也可以直接按')} <Kbd>Enter</Kbd></span>}
            <button className="btn primary big" disabled={!canCompare} onClick={startCompare}>{A && B ? t('开始比较') : t('还差 {n} 个文档', { n: 2 - (A ? 1 : 0) - (B ? 1 : 0) })}</button>
          </div>
        {modals}
      </div>
    );
  }

  // =================== 比较界面 ===================
  const stats = curRes?.stats;
  const undecided = changes.length - decidedCount;
  const navCount = (i: number) => i === 0 ? richRes?.changes.length : i === 1 ? plainRes?.changes.length : i === 2 ? (richRes ? richRes.changes.length - Object.keys(decisions).length : undefined) : i === 4 ? ocrRes?.changes.length : undefined;

  const navBtns = changes.length > 0 && (
    <span style={{ display: 'inline-flex', gap: 8 }}>
      <button className="btn sm" onClick={() => go(-1)} title={t('上一处（K）')}><I.IconUp />{t('上一处')}</button>
      <button className="btn sm" onClick={() => go(1)} title={t('下一处（J）')}><I.IconDown />{t('下一处')}</button>
    </span>
  );

  // 中间工具条
  let tools: React.ReactNode = null;
  if (tab === 0) tools = (<><span className="legend"><span><span className="tag del">{t('删除')}</span></span><span><span className="tag ins">{t('新增')}</span></span><span><span className="tag fmt">{t('格式')}</span></span><span><span className="tag move">{t('移动')}</span></span></span><span className="grow" />{navBtns}</>);
  else if (tab === 1) tools = (<><Seg value={prefs.layout} options={[['split', t('并排')], ['unified', t('合并')]]} onChange={set('layout')} /><span className="grow" />{navBtns}</>);
  else if (tab === 2) tools = (
    <>
      <div className="progress-lg"><div style={{ width: `${changes.length ? (decidedCount / changes.length) * 100 : 100}%` }} /></div>
      <span className="progress-label">{decidedCount} / {changes.length}</span>
      <div style={{ position: 'relative' }}>
        <button className="btn sm" onClick={() => setExportOpen((v) => !v)}><I.IconExport />{t('导出')}</button>
        {exportOpen && (
          <div className="menu" style={{ right: 0, top: 40 }} onMouseLeave={() => setExportOpen(false)}>
            <button onClick={() => { setExportOpen(false); exportDocx(true); }}><b>{t('Word 最终稿')}</b><small>{t('还没处理的修订按“接受”算')}</small></button>
            <button onClick={() => { setExportOpen(false); exportDocx(false); }}><b>{t('Word 修订稿')}</b><small>{t('保留删除线和下划线标记')}</small></button>
            <button onClick={() => { setExportOpen(false); exportPdf(); }}><b>PDF</b><small>{t('当前修订视图，适合发给别人看')}</small></button>
          </div>
        )}
      </div>
    </>
  );
  else if (tab === 3) tools = (
    <>
      <Seg value={prefs.imgMode} options={[['split', t('并排')], ['diff', t('差异')], ['fade', t('淡化')], ['slider', t('滑块')]]} onChange={set('imgMode')} />
      {prefs.imgMode === 'fade' && <><span className="progress-label">{t('原始')}</span><input type="range" className="range" style={{ width: 200 }} min={0} max={100} value={fade} onChange={(e) => setFade(Number(e.target.value))} /><span className="progress-label">{t('修改后')}</span></>}
      {prefs.imgMode === 'slider' && <span className="progress-label">{t('拖动页面上的分割线来对比')}</span>}
      <span className="grow" />
      <select className="sel" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title={t('缩放')}>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
      </select>
    </>
  );
  else if (tab === 4) tools = (
    <>
      <select className="sel" value={prefs.ocrLang} onChange={(e) => set('ocrLang')(e.target.value as OcrLang)} disabled={ocr.status === 'running'}>
        <option value="chi_sim+eng">{t('中文 + 英文')}</option><option value="chi_sim">{t('仅中文')}</option><option value="eng">{t('仅英文')}</option>
      </select>
      {ocr.status === 'running' ? <button className="btn sm danger-outline" onClick={cancelOcr}><I.IconX />{t('取消识别')}</button>
        : <button className="btn sm blue" onClick={runOcr}><I.IconOcr />{t(ocrRes ? '重新识别' : '开始识别')}</button>}
      <span className="grow" />{ocrRes && navBtns}
    </>
  );

  // 主体
  let body: React.ReactNode = null;
  if (tab === 0 && richRes) body = richRes.rows.length ? <RichView A={A} B={B} res={richRes} selCid={selCid} onSel={setSelCid} hideUnchanged={prefs.hideRich} />
    : <div className="empty-state"><Mascot mood="oops" /><h2>{t('没找到可以比较的文字')}</h2><div>{t((A.type === 'pdf' || B.type === 'pdf') ? '如果是扫描件，试试「OCR 文本」或「图像」模式。' : '两份文档好像都是空的。')}</div></div>;
  else if (tab === 1 && plainRes && plainBlocks) body = <PlainView A={plainBlocks[0]} B={plainBlocks[1]} res={plainRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} />;
  else if (tab === 2 && richRes) body = changes.length ? <RedlineView A={A} B={B} res={richRes} selCid={selCid} onSel={setSelCid} decisions={decisions} innerRef={redlineRef} />
    : <div className="empty-state"><Mascot mood="cheer" /><h2>{t('没有需要审阅的修订')}</h2><div>{t('两份文档内容一致。')}</div></div>;
  else if (tab === 3) body = <ImageView state={imgState} mode={prefs.imgMode} zoom={zoom} fade={fade} setFade={setFade} slider={slider} setSlider={setSlider} showBoxes={prefs.showBoxes} onlyDiff={onlyDiffPages} scrollRef={imgScroll} />;
  else if (tab === 4) {
    if (ocrRes && ocrBlocks) body = <PlainView A={ocrBlocks[0]} B={ocrBlocks[1]} res={ocrRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} />;
    else if (ocr.status === 'running') body = <div className="empty-state"><Mascot mood="think" className="mascot-bob" /><h2>{t('正在认真读字…')}</h2><div>{ocr.msg}</div><div className="progress"><div style={{ width: `${ocr.pct || 0}%` }} /></div><button className="btn sm plain" onClick={cancelOcr}>{t('取消')}</button></div>;
    else body = (
      <div className="empty-state">
        <Mascot mood={ocr.status === 'error' ? 'oops' : 'happy'} />
        <h2>{t('先识别，再比较')}</h2>
        <div>{t('把两份文档的每一页当成图片来识别文字。适合扫描件、截图型 PDF。')}<br />{t('每页大约 3–5 秒，完全离线。')}</div>
        {ocr.status === 'error' && <div className="err">{t('识别失败')}：{ocr.msg}</div>}
        <button className="btn primary big" onClick={runOcr}>{t('开始识别')}</button>
      </div>
    );
  } else if (tab === 5) body = <DetailsView A={A} B={B} />;

  const showMap = (tab === 0 || tab === 1 || tab === 2 || (tab === 4 && !!ocrRes)) && changes.length > 0;
  const cur = changes.find((c) => c.id === selCid);
  const curIdx = changes.findIndex((c) => c.id === selCid);

  // 右侧卡片
  const summaryCard = curRes && (
    <Card title={t('差异概览')} right={changes.length > 0 && <button className="btn sm" onClick={copySummary} title={t('复制为 Markdown，可粘贴到邮件 / 飞书 / 文档')}><I.IconCopy />{t('复制摘要')}</button>}>
      {changes.length === 0 ? (
        <div className="same-banner"><Mascot mood="cheer" size={48} />{t('内容完全一致！')}</div>
      ) : (
        <div className="stats">
          <div className="stat-tile del"><span className="ic">−</span><div><b>{stats!.del}</b><br /><span>{t('删除')}</span></div></div>
          <div className="stat-tile ins"><span className="ic">+</span><div><b>{stats!.ins}</b><br /><span>{t('新增')}</span></div></div>
          <div className="stat-tile mod"><span className="ic">✎</span><div><b>{stats!.mod}</b><br /><span>{t('修改')}</span></div></div>
          <div className="stat-tile other"><span className="ic">⇅</span><div><b>{stats!.fmt + stats!.move}</b><br /><span>{t('格式 / 移动')}</span></div></div>
        </div>
      )}
    </Card>
  );
  const compareSettings = (
    <>
      <Opt label={t('忽略空白差异')} hint={t('多余空格、换行符不同')}><Switch on={prefs.ignoreWs} onChange={set('ignoreWs')} /></Opt>
      <Opt label={t('忽略全角 / 半角标点')} hint={t('，和 ,　（和 (　视为相同')}><Switch on={prefs.normPunct} onChange={set('normPunct')} /></Opt>
      <Opt label={t('忽略大小写')}><Switch on={prefs.ignoreCase} onChange={set('ignoreCase')} /></Opt>
      <Opt label={t('检测移动的段落')}><Switch on={prefs.detectMoves} onChange={set('detectMoves')} /></Opt>
      {(tab === 0 || tab === 2) && <Opt label={t('检测格式变化')} hint={t(A.type !== B.type ? 'Word 与 PDF 互比时默认关闭' : '加粗、字号、颜色、标题级别')}><Switch on={formatting} onChange={setFormatting} /></Opt>}
      {tab === 0 && <Opt label={t('只看有变化的段落')}><Switch on={prefs.hideRich} onChange={set('hideRich')} /></Opt>}
      {(tab === 1 || tab === 4) && <><Opt label={t('只看有变化的行')}><Switch on={prefs.hidePlain} onChange={set('hidePlain')} /></Opt><Opt label={t('自动换行')}><Switch on={prefs.wrap} onChange={set('wrap')} /></Opt></>}
      <Opt label={t('比较精度')}><Seg value={prefs.precision} options={[['word', t('按词')], ['char', t('按字符')]]} onChange={set('precision')} /></Opt>
      {tab === 2 && <Opt label={t('音效')}><Switch on={prefs.sound} onChange={set('sound')} /></Opt>}
    </>
  );
  let aside: React.ReactNode = null;
  if (tab === 0 || tab === 1 || tab === 2 || tab === 4) {
    aside = (
      <>
        {summaryCard}
        {tab === 2 && changes.length > 0 && (
          <Card title={t('批量处理')}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button className="btn sm" style={{ '--fg-b': 'var(--feather-dark)' } as any} onClick={() => decideAll('a')}><I.IconCheck />{t('全部接受')}</button>
              <button className="btn sm danger-outline" onClick={() => decideAll('r')}><I.IconX />{t('全部拒绝')}</button>
            </div>
            {decidedCount > 0 && <button className="btn sm plain block" style={{ marginTop: 8 }} onClick={() => decideAll(null)}>{t('重置所有决定')}</button>}
          </Card>
        )}
        {changes.length > 0 && (
          <Card className="grow-card" title={<>{t(tab === 2 ? '修订列表' : '变更列表')} <span style={{ color: 'var(--text-3)', fontSize: 14 }}>{changes.length}</span></>}>
            <ChangeList changes={changes} sel={selCid} onSel={setSelCid} decisions={tab === 2 ? decisions : undefined} />
          </Card>
        )}
        <Card title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><I.IconGear />{t('比较设置')}</span>} collapsible open={settingsOpen} onToggle={() => setSettingsOpen((v) => !v)}>
          <div>{compareSettings}</div>
        </Card>
      </>
    );
  } else if (tab === 3) {
    const diffPages = imgState.diffs.filter((d) => d.pct >= 0.001).length;
    aside = (
      <>
        <Card title={t('版面对比')}>
          {imgState.loading && !imgState.diffs.length ? <div className="progress-label">{imgState.loading}</div> : diffPages ? (
            <div className="stats"><div className="stat-tile del"><span className="ic">!</span><div><b>{diffPages}</b><br /><span>{t('页有差异')}</span></div></div><div className="stat-tile ins"><span className="ic">✓</span><div><b>{imgState.diffs.length - diffPages}</b><br /><span>{t('页相同')}</span></div></div></div>
          ) : <div className="same-banner"><Mascot mood="cheer" size={48} />{t('每一页都一模一样！')}</div>}
          <div style={{ marginTop: 10 }}>
            <Opt label={t('标出差异区域')}><Switch on={prefs.showBoxes} onChange={set('showBoxes')} /></Opt>
            <Opt label={t('只看有差异的页')}><Switch on={onlyDiffPages} onChange={setOnlyDiffPages} /></Opt>
            <Opt label={t('灵敏度')}>
              <select className="sel" value={prefs.threshold} onChange={(e) => set('threshold')(Number(e.target.value))}>
                <option value={0.03}>{t('很高')}</option><option value={0.1}>{t('标准')}</option><option value={0.2}>{t('较低')}</option><option value={0.35}>{t('低')}</option>
              </select>
            </Opt>
          </div>
        </Card>
        <Card className="grow-card" title={t('页面')}>
          <div className="pagelist" style={{ overflow: 'auto' }}>
            {imgState.diffs.map((d, i) => (
              <button key={i} onClick={() => document.getElementById(`page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span><span className="dot" style={{ background: d.pct < 0.001 ? 'var(--feather)' : 'var(--cardinal)' }} />{t('第 {n} 页', { n: i + 1 })}</span>
                <span style={{ color: 'var(--text-3)' }}>{d.aMissing || d.bMissing ? t('缺页') : d.pct < 0.001 ? t('相同') : `${d.pct < 0.01 ? '<0.01' : d.pct.toFixed(2)}%`}</span>
              </button>
            ))}
          </div>
          <div className="progress-label" style={{ fontSize: 12, marginTop: 10, fontWeight: 700, whiteSpace: 'normal', lineHeight: 1.5 }}>{t('Word 和 TXT 会先在本机排成页面再比较，分页可能和 Word 略有不同。')}</div>
        </Card>
      </>
    );
  }

  const navOpen = prefs.navOpen, asideOpen = prefs.asideOpen && !!aside;
  return (
    <div className={`app shell ${aside ? '' : 'no-aside'} ${navOpen ? '' : 'nav-mini'} ${asideOpen ? '' : 'aside-off'}`}>
      <nav className="nav">
        <div className="nav-drag drag" />
        <div className="nav-brand drag"><Wordmark size={34} /></div>
        {MODES.map((m, i) => {
          const n = navCount(i);
          return (
            <button key={i} className={`nav-item ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)} title={kbd(`mod+${i + 1}`)}>
              {m.icon}<span>{t(m.label)}</span>{n !== undefined && <span className="count">{n}</span>}
            </button>
          );
        })}
        <div className="spacer" />
        <div className="nav-foot">
          <button className="nav-item" onClick={clearAll} title={t('新建比较')}><I.IconPlusDoc /><span>{t('新建比较')}</span></button>
          <button className="nav-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t(theme === 'dark' ? '浅色模式' : '深色模式')}>{theme === 'dark' ? <I.IconSun /> : <I.IconMoon />}<span>{t(theme === 'dark' ? '浅色模式' : '深色模式')}</span></button>
          <button className="nav-item" onClick={() => setShowSettings(true)} title={t('设置')}><I.IconGear /><span>{t('设置')}</span></button>
          <button className="nav-item collapse" onClick={() => set('navOpen')(!navOpen)} title={t(navOpen ? '收起侧边栏' : '展开侧边栏')}>{navOpen ? <I.IconChevronLeft /> : <I.IconChevronRight />}<span>{t('收起侧边栏')}</span></button>
        </div>
      </nav>

      <div className="center">
        <div className="center-head drag">
          <FilePill side={0} doc={A} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} changed={changedSides.includes(0)} />
          <button className="vs-chip" title={t('交换左右（{k}）', { k: kbd('mod+shift+S') })} onClick={swap}><I.IconSwap /></button>
          <FilePill side={1} doc={B} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} changed={changedSides.includes(1)} />
          {(busy[0] || busy[1]) && <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />}
          {aside && <button className={`btn plain icon panel-toggle ${asideOpen ? 'on' : ''}`} onClick={() => set('asideOpen')(!asideOpen)} title={t(asideOpen ? '收起右侧面板' : '展开右侧面板')}><I.IconPanelRight /></button>}
        </div>
        {changedSides.length > 0 && (
          <div className="banner">
            <I.IconRefresh />
            <span className="grow">{t('「{f}」刚刚在磁盘上被修改了', { f: changedSides.map((s) => docs[s]?.file.name).join('」/「') })}</span>
            <button className="btn sm blue" onClick={reloadChanged}>{t('重新比较')}</button>
            <button className="btn sm plain" onClick={() => setChangedSides([])}>{t('忽略')}</button>
          </div>
        )}
        {(errs[0] || errs[1]) && <div className="err" style={{ margin: '0 18px 12px' }}>{errs[0] || errs[1]}</div>}
        {tools && <div className="center-tools">{tools}</div>}
        <div className="center-body">
          <div className="main">
            {body}
            {showMap && <ChangeMap bottom={tab === 2 ? 92 : 6} changes={changes} selCid={selCid} onSel={setSelCid} dep={[curRes, tab, prefs.hideRich, prefs.hidePlain, prefs.layout, prefs.wrap, decisions]} />}
            {tab === 2 && changes.length > 0 && (
              <div className={`review-bar ${feedback || ''}`}>
                {feedback ? (
                  <div className="info"><span className="fb">{feedback === 'ok' ? <><I.IconCheck />{t('已接受，保留新版本')}</> : <><I.IconX />{t('已拒绝，恢复原文')}</>}</span></div>
                ) : cur ? (
                  <div className="info">
                    <span className="t"><span className={`tag ${cur.kind}`}>{KIND_LABEL[cur.kind]}</span>{t('第 {i} / {n} 处', { i: curIdx + 1, n: changes.length })}{decisions[cur.id] && <span className={`dec ${decisions[cur.id]}`}>{decisions[cur.id] === 'a' ? `· ${t('已接受')}` : `· ${t('已拒绝')}`}</span>}</span>
                    <span className="d">{cur.kind === 'mod' ? `“${short(cur.before, 40)}” → “${short(cur.after, 40)}”` : cur.kind === 'ins' ? `${t('新增')}：${short(cur.after, 80)}` : cur.kind === 'del' ? `${t('删除')}：${short(cur.before, 80)}` : cur.kind === 'fmt' ? `${short(cur.before, 40)}（${cur.note}）` : `${t('移动')}：${short(cur.before, 80)}`}</span>
                  </div>
                ) : <div className="info"><span className="t">{t('点文中任意一处修订开始审阅')}</span></div>}
                <span className="keys"><Kbd>R</Kbd>{t('拒绝')} <Kbd>A</Kbd>{t('接受')} <Kbd>J</Kbd><Kbd>K</Kbd>{t('切换')}</span>
                <button className="btn red big" disabled={!cur} onClick={() => decide(selCid, 'r')}>{t('拒绝')}</button>
                <button className="btn primary big" disabled={!cur} onClick={() => decide(selCid, 'a')}>{t('接受')}</button>
              </div>
            )}
            {tab === 2 && doneOpen && (
              <div className="overlay-bg">
                <Confetti />
                <div className="done-card">
                  <Mascot mood="cheer" size={150} />
                  <h2>{t('审阅完成！')}</h2>
                  <div style={{ color: 'var(--text-2)', fontWeight: 700 }}>{t('{n} 处修订全部处理完毕', { n: changes.length })}</div>
                  <div className="done-stats">
                    <div className="done-stat a"><div className="h">{t('接受')}</div><div className="v">{Object.values(decisions).filter((v) => v === 'a').length}</div></div>
                    <div className="done-stat r"><div className="h">{t('拒绝')}</div><div className="v">{Object.values(decisions).filter((v) => v === 'r').length}</div></div>
                  </div>
                  <div className="done-acts">
                    <button className="btn primary big block" onClick={() => exportDocx(true)}>{t('导出 Word 最终稿')}</button>
                    <button className="btn big block" onClick={exportPdf}>{t('导出 PDF 修订对比')}</button>
                    <button className="btn plain block" onClick={() => setDoneOpen(false)}>{t('回去再看看')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {aside && asideOpen && <aside className="aside"><div className="aside-drag drag" />{aside}</aside>}
      {modals}
    </div>
  );
}
