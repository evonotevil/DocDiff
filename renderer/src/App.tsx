import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DocModel, FileInfo } from './lib/model';
import { compareBlocks, docPlainText, fmtBytes } from './lib/model';
import { loadDoc } from './lib/load';
import { NeedPassword } from './lib/pdf';
import { linesToBlocks, DiffOptions, DiffResult, Change, ChangeKind } from './lib/engine';
import { buildDocx } from './lib/exportDocx';
import { getPages } from './lib/pages';
import { kbd, modPressed } from './lib/platform';
import { t, setLang, initLang, Lang } from './lib/i18n';
import { clauseMap, detectRisks, DEFAULT_KEYWORDS, Risk } from './lib/insight';
import { DecMap, Dec, Verdict, pairKey, loadDecisions, saveDecisions, reviewProgress, initialsOf } from './lib/review';
import { scopeInfo } from './lib/scope';
import { summaryMarkdown, reportHtml } from './lib/report';
import { ChangeList, KIND_LABEL, short } from './components/ChangeList';
import { ChangeMap } from './components/ChangeMap';
import { Overview, RiskList, ScopeBody } from './components/Panels';
import { Panel, PanelGroup, Notice, usePanelState } from './components/Panel';
import { ExportDialog, ExportKind } from './components/ExportDialog';
import { SettingsModal, SettingsValues, UpdInfo, APP_VERSION } from './components/SettingsModal';
import { Modal } from './components/Modal';
import { Mascot, Confetti } from './components/Mascot';
import { Wordmark } from './components/Logo';
import { Switch, Opt, Seg, Kbd, useMedia } from './components/ui';
import * as I from './components/icons';
import { RichView } from './views/RichView';
import { PlainView } from './views/PlainView';
import { RedlineView } from './views/RedlineView';
import { ImageView, ImgMode, useImagePages } from './views/ImageView';
import { DetailsView } from './views/DetailsView';
import { noteText } from './lib/describe';
import { useDiff } from './lib/useDiff';

const api = (window as any).api;
type Side = 0 | 1;
const sideLabel = (s: Side) => t(s ? '修改后文档' : '原始文档');
// 每个模式有自己的颜色（1.6.2）：左栏选中态、首页功能图标都用它
const MODES = [
  { label: '富文本', icon: <I.ModeRich />, c: 'macaw' },
  { label: '纯文本', icon: <I.ModePlain />, c: 'wolf' },
  { label: '修订审阅', icon: <I.ModeRedline />, c: 'bee' },
  { label: '图像', icon: <I.ModeImage />, c: 'feather' },
  { label: 'OCR 文本', icon: <I.ModeOcr />, c: 'beetle' },
  { label: '文件详情', icon: <I.ModeDetails />, c: 'fox' },
];

// ---------- 设置持久化 ----------
interface Prefs {
  ignoreCase: boolean; ignoreWs: boolean; precision: 'word' | 'char'; detectMoves: boolean; normPunct: boolean;
  hideRich: boolean; hidePlain: boolean; layout: 'split' | 'unified'; wrap: boolean;
  imgMode: ImgMode; threshold: number; showBoxes: boolean; ocrLang: OcrLang; sound: boolean;
  navOpen: boolean; asideOpen: boolean;
  autoCheckUpdate: boolean; skipVersion: string;
  // 1.6
  reviewerName: string; reviewerInitials: string; reviewerAsked: boolean;
  authorName: string; commentAccepted: boolean;
  riskMoney: boolean; riskDate: boolean; keywords: string[];
  paperFollowTheme: boolean; celebrate: boolean;
}
const sysUser = (() => { try { return String(api.userName?.() || ''); } catch { return ''; } })();
const DEFAULT_PREFS: Prefs = {
  ignoreCase: false, ignoreWs: true, precision: 'word', detectMoves: true, normPunct: false,
  hideRich: false, hidePlain: false, layout: 'split', wrap: true,
  imgMode: 'split', threshold: 0.1, showBoxes: true, ocrLang: 'chi_sim+eng', sound: true,
  navOpen: true, asideOpen: true,
  autoCheckUpdate: true, skipVersion: '',
  reviewerName: sysUser, reviewerInitials: initialsOf(sysUser), reviewerAsked: false,
  authorName: '', commentAccepted: true,
  riskMoney: true, riskDate: true, keywords: DEFAULT_KEYWORDS,
  paperFollowTheme: false, celebrate: false,
};
function loadPrefs(): Prefs {
  try { return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem('prefs-v2') || '{}') }; } catch { return DEFAULT_PREFS; }
}

// ---------- 音效（很轻的提示音，可在设置里关闭） ----------
let actx: AudioContext | null = null;
function chime(kind: 'ok' | 'no' | 'hold' | 'done') {
  try {
    actx ||= new AudioContext();
    const notes = kind === 'ok' ? [880, 1320] : kind === 'no' ? [330, 262] : kind === 'hold' ? [587, 587] : [523, 659, 784, 1047];
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
async function sampleFile(name: string): Promise<FileInfo> {
  const r = await fetch(`samples/${encodeURIComponent(name)}`);
  const data = new Uint8Array(await r.arrayBuffer());
  const now = Date.now();
  return { path: '', name, ext: 'docx', size: data.length, mtime: now, birthtime: now, data };
}
const docStat = (d: DocModel) => `${d.type.toUpperCase()} · ${fmtBytes(d.file.size)}${d.pageCount ? ` · ${t('{n} 页', { n: d.pageCount })}` : ''}`;

/** 长文件名从中间省略，保留扩展名（法务文件名的版本信息常在尾部） */
function midEllipsis(name: string, max = 34) {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, dot) : name;
  const keep = max - ext.length - 1;
  const head = Math.ceil(keep * 0.6), tail = Math.floor(keep * 0.4);
  return `${stem.slice(0, head)}…${stem.slice(stem.length - tail)}${ext}`;
}

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
          {doc.type === 'pdf' && doc.blocks.length === 0 && <Notice tone="warn" className="stack" title={t('没读到文字，可能是扫描件。')}>{t('比较后用「OCR 文本」或「图像」模式。')}</Notice>}
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
      {error && <Notice tone="err" className="stack" title={error} />}
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
      <button className="btn sm plain icon" onClick={onOpen} title={t('换一个文件（也可以直接拖进来）')} aria-label={t('换一个文件')}><I.IconUpload /></button>
    </div>
  );
}

function PasswordModal({ name, wrong, onOk, onCancel }: { name: string; wrong: boolean; onOk: (p: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title={t('这个 PDF 有密码')} onClose={onCancel} footer={<><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" onClick={() => onOk(v)}>{t('打开')}</button></>}>
      <p>{t('「{f}」受密码保护。', { f: name })}{wrong && <b className="danger-text">{t('密码不对，再试一次。')}</b>}</p>
      <input type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(v)} placeholder={t('输入密码')} aria-label={t('输入密码')} />
    </Modal>
  );
}

function PasteModal({ side, onOk, onCancel }: { side: Side; onOk: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title={t('粘贴{s}的文字', { s: sideLabel(side) })} onClose={onCancel} className="wide"
      footer={<><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" disabled={!v.trim()} onClick={() => onOk(v)}>{t('使用这段文字')}</button></>}>
      <p>{t('直接粘贴从网页、邮件、聊天软件里复制的内容。')}</p>
      <textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('在这里粘贴…（{k}）', { k: kbd('mod+V') })} aria-label={t('粘贴文字')} />
    </Modal>
  );
}

// ---------- OCR ----------
type OcrLang = 'chi_sim+eng' | 'eng' | 'chi_sim';
interface OcrState { status: 'idle' | 'running' | 'done' | 'error'; msg?: string; pct?: number; a?: string; b?: string; key?: string; conf?: [number[], number[]]; low?: [Map<number, Set<number>>, Map<number, Set<number>>] }
function cleanOcr(t: string) {
  return t
    .replace(/([　-〿㐀-鿿＀-￯])[ \t]+(?=[　-〿㐀-鿿＀-￯])/g, '$1')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
class Cancelled extends Error { constructor() { super('已取消'); } }
/** 把低置信度的词对回最终文字里的位置：行号 → 这一行里低置信度字符的下标 */
function lowPositions(text: string, words: [string, number][], threshold = 70): Map<number, Set<number>> {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  const lineOf = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (starts[m] <= pos) lo = m; else hi = m - 1; } return lo; };
  const out = new Map<number, Set<number>>();
  let p = 0;
  for (const [w, c] of words) {
    const ww = String(w).replace(/\s+/g, '');
    if (!ww) continue;
    const idx = text.indexOf(ww, p);
    if (idx < 0 || idx - p > 400) continue;
    if (c < threshold) for (let k = idx; k < idx + ww.length; k++) { const ln = lineOf(k); (out.get(ln) || out.set(ln, new Set()).get(ln)!).add(k - starts[ln]); }
    p = idx + ww.length;
  }
  return out;
}

const VERDICT_FB: Record<Verdict, string> = { a: '已接受，保留新版本', r: '已拒绝，恢复原文', h: '已标为待议，留给律师或领导判断' };
const VERDICT_SHORT: Record<Verdict, string> = { a: '已接受', r: '已拒绝', h: '待议' };

// =========================================================
export default function App() {
  const [docs, setDocs] = useState<[DocModel | null, DocModel | null]>([null, null]);
  const [busy, setBusy] = useState<[boolean, boolean]>([false, false]);
  const [errs, setErrs] = useState<[string | null, string | null]>([null, null]);
  const [pwd, setPwd] = useState<{ side: Side; file: FileInfo; wrong: boolean } | null>(null);
  const [pasteSide, setPasteSide] = useState<Side | null>(null);
  const [showSettings, setShowSettings] = useState<false | 'general' | 'review' | 'risk' | 'keys' | 'about'>(false);
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
  const panels = usePanelState();
  const [recent, setRecent] = useState<any[]>([]);
  const [changedSides, setChangedSides] = useState<Side[]>([]);
  const [selCid, setSelCid] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<DecMap>({});
  const [feedback, setFeedback] = useState<Verdict | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  const [dismissDegraded, setDismissDegraded] = useState(false);
  const [dismissCross, setDismissCross] = useState('');
  const [lostBanner, setLostBanner] = useState<{ n: number; restore: () => void } | null>(null);
  const [upd, setUpd] = useState<UpdInfo | null>(null);
  const [checkingUpd, setCheckingUpd] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [expAuthor, setExpAuthor] = useState('');
  const [kindFilter, setKindFilter] = useState<ChangeKind[]>([]);
  const [editName, setEditName] = useState<string | null>(null);
  const [fade, setFade] = useState(50);
  const [slider, setSlider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [onlyDiffPages, setOnlyDiffPages] = useState(false);
  const [ocr, setOcr] = useState<OcrState>({ status: 'idle' });
  const ocrRun = useRef(0);
  const decideOrder = useRef<number[]>([]);
  const imgScroll = useRef<HTMLDivElement>(null);
  const redlineRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const narrow = useMedia('(max-width: 1180px)');
  const [navWide, setNavWide] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('theme', theme); } catch {} api.setTheme?.(theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.paper = prefs.paperFollowTheme ? 'theme' : 'light'; }, [prefs.paperFollowTheme]);
  useEffect(() => { try { localStorage.setItem('prefs-v2', JSON.stringify(prefs)); } catch {} }, [prefs]);
  useEffect(() => { api.setLang?.(lang); }, []);
  useEffect(() => { api.recentGet?.().then(setRecent); }, [compared]);
  const toastTimer = useRef<any>(0);
  const flash = (m: string) => { clearTimeout(toastTimer.current); setToast(m); toastTimer.current = setTimeout(() => setToast(null), 3200); };

  // ---------- 检查更新 ----------
  const checkUpdate = useCallback(async (manual: boolean) => {
    if (!api.checkUpdate) return;
    setCheckingUpd(true);
    try {
      const r: UpdInfo = await api.checkUpdate();
      setUpd(r);
      if (manual && r.status === 'latest') flash(t('已是最新版本'));
      if (manual && r.status === 'error') flash(t('没能连上更新服务器：{e}', { e: t(r.error || '') }));
    } catch {
      setUpd({ status: 'error', current: APP_VERSION, error: t('检查失败') });
    } finally {
      setCheckingUpd(false);
    }
  }, []);
  useEffect(() => {
    if (!prefs.autoCheckUpdate) return;
    const timer = setTimeout(() => checkUpdate(false), 8000);
    return () => clearTimeout(timer);
  }, []);
  const updBadge = upd?.status === 'new' && upd.latest !== prefs.skipVersion;

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
  const trySample = async () => {
    try {
      await Promise.all([loadFile(0, await sampleFile('示例合同_v1.docx')), loadFile(1, await sampleFile('示例合同_v2.docx'))]);
      setCompared(true); setTab(0);
    } catch { flash(t('示例文件没能打开')); }
  };

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
      const f = (d: DocModel) => ({ path: d.file.path, name: d.file.name, ext: d.type, sha: d.sha256 });
      api.recentAdd?.({ a: f(A), b: f(B) });
    }
    api.watch?.([A.file.path, B.file.path].filter(Boolean));
  }, [compared, A?.file.path, B?.file.path, A?.sha256, B?.sha256]);
  useEffect(() => api.onFileChanged?.((p: string) => {
    setDocs((ds) => {
      const sides = ([0, 1] as Side[]).filter((s) => ds[s]?.file.path === p);
      if (sides.length) setChangedSides((c) => [...new Set([...c, ...sides])]);
      return ds;
    });
  }), []);
  const carryFrom = useRef('');
  const reloadChanged = async () => {
    carryFrom.current = pairKey(A?.sha256, B?.sha256); // 文件改了 SHA 就变了：把上一版的决定带过来，能认回来的都认回来
    for (const s of changedSides) { const d = docs[s]; if (d?.file.path) await loadFile(s, await api.readPath(d.file.path)); }
    setChangedSides([]);
    flash(t('已按最新文件重新比较'));
  };
  useEffect(() => { if (!compared) api.watch?.([]); }, [compared]);

  // ---------- 比较 ----------
  const opts: DiffOptions = { ignoreCase: prefs.ignoreCase, ignoreWhitespace: prefs.ignoreWs, precision: prefs.precision, formatting, detectMoves: prefs.detectMoves, normPunct: prefs.normPunct };
  const optKey = JSON.stringify(opts);
  const docSig = A && B ? `${A.sha256 || A.file.path}|${B.sha256 || B.file.path}` : '';
  // 富文本 / 修订审阅：正文 + 页眉 + 页脚 + 脚注
  const RA = useMemo(() => (A ? { ...A, blocks: compareBlocks(A) } : null), [A]);
  const RB = useMemo(() => (B ? { ...B, blocks: compareBlocks(B) } : null), [B]);
  const richTask = useMemo(() => (compared && RA && RB
    ? { key: `rich|${docSig}|${optKey}`, blocksA: RA.blocks, blocksB: RB.blocks, opts: { ...opts, mergeParas: true } }
    : null), [compared, docSig, optKey, RA, RB]);
  const rich = useDiff(richTask);
  const richRes = rich.res;

  const plainBlocks = useMemo(() => (A && B ? [linesToBlocks(docPlainText(A)), linesToBlocks(docPlainText(B))] : null), [A, B]);
  const plainTask = useMemo(() => (compared && plainBlocks && tab === 1
    ? { key: `plain|${docSig}|${optKey}`, blocksA: plainBlocks[0], blocksB: plainBlocks[1], opts: { ...opts, formatting: false, keepEmpty: true } }
    : null), [compared, plainBlocks, docSig, optKey, tab]);
  const plain = useDiff(plainTask);
  const plainRes = plain.res;

  const ocrKey = A && B ? `${A.sha256}|${B.sha256}|${prefs.ocrLang}` : '';
  const ocrBlocks = useMemo(() => (ocr.status === 'done' && ocr.key === ocrKey ? [linesToBlocks(ocr.a!), linesToBlocks(ocr.b!)] : null), [ocr, ocrKey]);
  const ocrTask = useMemo(() => (ocrBlocks && tab === 4
    ? { key: `ocr|${ocrKey}|${optKey}`, blocksA: ocrBlocks[0], blocksB: ocrBlocks[1], opts: { ...opts, formatting: false, keepEmpty: true } }
    : null), [ocrBlocks, ocrKey, optKey, tab]);
  const ocrDiff = useDiff(ocrTask);
  const ocrRes = ocrDiff.res;
  const diffJob = tab === 1 ? plain : tab === 4 ? ocrDiff : rich;
  const imgState = useImagePages(tab === 3 && compared && A && B ? A : (null as any), tab === 3 && compared && A && B ? B : (null as any), prefs.threshold);

  // ---------- 解读：条款、风险、比较范围 ----------
  const clauses = useMemo(() => (richRes && RA && RB ? clauseMap(richRes, RA.blocks, RB.blocks) : new Map<number, string | null>()), [richRes, RA, RB]);
  const risks: Risk[] = useMemo(() => (richRes ? detectRisks(richRes, clauses, { money: prefs.riskMoney, date: prefs.riskDate, keywords: prefs.keywords }) : []), [richRes, clauses, prefs.riskMoney, prefs.riskDate, prefs.keywords]);
  const riskById = useMemo(() => new Map(risks.map((r) => [r.cid, r])), [risks]);
  const scope = useMemo(() => (A && B ? scopeInfo(A, B, opts, richRes) : null), [A, B, optKey, richRes, lang]);
  const noClauses = useMemo(() => new Map<number, string | null>(), []);

  // ---------- 审阅决定：载入 / 保存 / 设置变化后的迁移 ----------
  const pk = pairKey(A?.sha256, B?.sha256);
  const decFor = useRef<DiffResult | null>(null);
  const lastLoaded = useRef<{ pk: string; snap: string; opts: any } | null>(null);
  const optSnap = { ignoreCase: prefs.ignoreCase, ignoreWs: prefs.ignoreWs, precision: prefs.precision, detectMoves: prefs.detectMoves, normPunct: prefs.normPunct, formatting };
  useEffect(() => {
    if (!richRes) return;
    let { map, lost } = loadDecisions(pk, richRes.changes);
    if (!Object.keys(map).length && carryFrom.current && carryFrom.current !== pk) {
      map = loadDecisions(carryFrom.current, richRes.changes).map;
      if (Object.keys(map).length) flash(t('文件更新了，已带回上一版里还对得上的 {n} 个决定', { n: Object.values(map).filter((d) => d.v).length }));
    }
    carryFrom.current = '';
    decFor.current = richRes;
    setDecisions(map);
    setDoneOpen(false);
    decideOrder.current = [];
    const snap = JSON.stringify(optSnap);
    const prev = lastLoaded.current;
    if (prev && prev.pk === pk && prev.snap !== snap && lost > 0) {
      const restoreTo = prev.opts;
      setLostBanner({ n: lost, restore: () => {
        setPrefs((p) => ({ ...p, ignoreCase: restoreTo.ignoreCase, ignoreWs: restoreTo.ignoreWs, precision: restoreTo.precision, detectMoves: restoreTo.detectMoves, normPunct: restoreTo.normPunct }));
        setFormatting(restoreTo.formatting);
        setLostBanner(null);
      } });
    } else setLostBanner(null);
    lastLoaded.current = { pk, snap, opts: optSnap };
  }, [richRes]);
  useEffect(() => { if (richRes && decFor.current === richRes) saveDecisions(pk, richRes.changes, decisions); }, [decisions]);

  useEffect(() => setDismissDegraded(false), [docSig, optKey]);
  useEffect(() => setSelCid(null), [tab, richRes, plainRes, ocrRes]);
  useEffect(() => setKindFilter([]), [docSig]);

  const curRes: DiffResult | null = tab === 0 || tab === 2 ? richRes : tab === 1 ? plainRes : tab === 4 ? ocrRes : null;
  const changes: Change[] = curRes?.changes || [];
  const shown: Change[] = useMemo(() => (kindFilter.length ? changes.filter((c) => kindFilter.includes(c.kind)) : changes), [changes, kindFilter]);
  const changeById = useMemo(() => new Map(changes.map((c) => [c.id, c])), [changes]);

  const go = useCallback((d: number) => {
    if (!shown.length) return;
    const idx = shown.findIndex((c) => c.id === selCid);
    const n = idx < 0 ? (d > 0 ? 0 : shown.length - 1) : Math.min(shown.length - 1, Math.max(0, idx + d));
    setSelCid(shown[n].id);
  }, [shown, selCid]);

  // ---------- 修订审阅 ----------
  const decidedCount = changes.filter((c) => decisions[c.id]?.v).length;
  const nextUndecided = (after: number | null, dec: DecMap) => {
    const idx = shown.findIndex((c) => c.id === after);
    return shown.slice(idx + 1).find((c) => !dec[c.id]?.v) || shown.find((c) => !dec[c.id]?.v);
  };
  useEffect(() => { if (tab === 2 && selCid == null && shown.length) setSelCid((nextUndecided(null, decisions) || shown[0]).id); }, [tab, shown, selCid]);
  const reviewer = prefs.reviewerName.trim() || t('审阅人');
  const mkDec = (v: Verdict | undefined, prev?: Dec): Dec => ({ v, by: v ? reviewer : prev?.by || reviewer, at: Date.now(), note: prev?.note });
  const decide = (cid: number | null, v: Verdict | null) => {
    // 撤销：当前这处还没决定时，撤销最近一次决定并跳回那一处（刚按完 A/R 会自动跳到下一处）
    if (!v) {
      const target = cid != null && decisions[cid]?.v ? cid : decideOrder.current[decideOrder.current.length - 1];
      if (target == null || !decisions[target]?.v) return;
      const next = { ...decisions };
      if (next[target].note) next[target] = { ...next[target], v: undefined }; else delete next[target];
      decideOrder.current = decideOrder.current.filter((x) => x !== target);
      setDecisions(next);
      setSelCid(target);
      setDoneOpen(false);
      return;
    }
    if (cid == null) return;
    const next = { ...decisions, [cid]: mkDec(v, decisions[cid]) };
    decideOrder.current = [...decideOrder.current.filter((x) => x !== cid), cid];
    setDecisions(next);
    setFeedback(v);
    if (prefs.sound) chime(v === 'a' ? 'ok' : v === 'r' ? 'no' : 'hold');
    setTimeout(() => setFeedback(null), 700);
    const all = changes.every((c) => next[c.id]?.v);
    // 过半时鼓励一句（1.6.2）：只在这一次决定让进度越过一半时出现
    const before = changes.filter((c) => decisions[c.id]?.v).length, after = changes.filter((c) => next[c.id]?.v).length;
    if (!all && changes.length >= 6 && before * 2 < changes.length && after * 2 >= changes.length) flash(t('过半了！还剩 {n} 处', { n: changes.length - after }));
    if (all && changes.length) {
      setTimeout(() => { setDoneOpen(true); if (prefs.sound) chime('done'); }, 450);
    } else {
      const n = nextUndecided(cid, next);
      if (n) setTimeout(() => setSelCid(n.id), 220);
    }
  };
  const setNote = (cid: number, note: string) => {
    setDecisions((ds) => {
      const prev = ds[cid];
      const d: Dec = { v: prev?.v, by: prev?.by || reviewer, at: prev?.at || Date.now(), note: note || undefined };
      const next = { ...ds };
      if (!d.v && !d.note) delete next[cid]; else next[cid] = d;
      return next;
    });
  };
  const decideAll = (v: Verdict | null, onlyPending = false) => {
    if (!v) { decideOrder.current = []; setDecisions(Object.fromEntries(Object.entries(decisions).filter(([, d]) => d.note).map(([k, d]) => [k, { ...d, v: undefined }]))); return; }
    const next = { ...decisions };
    for (const c of changes) if (!onlyPending || !next[c.id]?.v) next[c.id] = mkDec(v, next[c.id]);
    decideOrder.current = changes.map((c) => c.id);
    setDecisions(next);
    if (!onlyPending && changes.length) { setDoneOpen(true); if (prefs.sound) chime('done'); }
  };

  // ---------- 导出 ----------
  const baseName = B ? B.file.name.replace(/\.[^.]+$/, '') : 'document';
  const defaultAuthor = () => prefs.authorName.trim() || B?.meta['最后修改者'] || B?.meta['作者'] || t('修改方');
  const openExport = () => { setExpAuthor(defaultAuthor()); setExportOpen(true); };
  const doExport = async (kind: ExportKind) => {
    if (!richRes || !RA || !RB || !A || !B || !scope) return;
    setExportBusy(true);
    try {
      if (kind === 'report') {
        const html = reportHtml({ A, B, res: richRes, clauses, risks, decisions, scope, reviewer }, RA.blocks, RB.blocks);
        const p = await api.htmlToPdf({ html, defaultName: `${baseName}-${t('比对报告')}.pdf` });
        if (p) { flash(t('已导出：{p}', { p })); setExportOpen(false); }
      } else {
        const bytes = await buildDocx(richRes.rows, RA.blocks, RB.blocks, {
          mode: kind === 'final' ? 'final' : 'redline',
          author: expAuthor.trim() || t('修改方'),
          authorDate: new Date(B.file.mtime || Date.now()),
          reviewer: { name: reviewer, initials: prefs.reviewerInitials.trim() || initialsOf(reviewer) },
          decisions, commentAccepted: prefs.commentAccepted, risks: riskById, changes: richRes.changes, title: baseName,
        });
        const p = await api.saveFile({ defaultName: `${baseName}-${t(kind === 'final' ? '审阅后定稿' : '修订稿')}.docx`, data: bytes, filters: [{ name: t('Word 文档'), extensions: ['docx'] }] });
        if (p) { flash(t('已导出：{p}', { p })); setExportOpen(false); }
      }
    } catch (e: any) {
      flash(t('导出失败：{e}', { e: String(e?.message || e) }));
    } finally {
      setExportBusy(false);
    }
  };
  const copySummary = () => {
    if (!curRes || !A || !B || !scope) return;
    const useRich = curRes === richRes;
    api.copyText(summaryMarkdown({ A, B, res: curRes, clauses: useRich ? clauses : noClauses, risks: useRich ? risks : [], decisions: useRich ? decisions : {}, scope, reviewer }));
    flash(t('已复制 {n} 处差异的摘要，可以直接粘贴', { n: curRes.changes.length }));
  };

  // ---------- OCR ----------
  const runOcr = async () => {
    if (!A || !B) return;
    const key = ocrKey;
    const run = ++ocrRun.current;
    const alive = () => { if (ocrRun.current !== run) throw new Cancelled(); };
    const langs = prefs.ocrLang.split('+');
    setOcr({ status: 'running', msg: t('正在准备页面…'), pct: 0, key });
    let off: (() => void) | null = null;
    try {
      const texts: string[] = [];
      const confs: number[][] = [], lows: Map<number, Set<number>>[] = [];
      for (const [si, d] of [[0, A], [1, B]] as [number, DocModel][]) {
        const pages = await getPages(d, 2, (i, n) => { if (ocrRun.current === run) setOcr((o) => ({ ...o, msg: t('正在准备{s}的第 {i}/{n} 页', { s: sideLabel(si as Side), i, n }) })); });
        alive();
        const imgs: Uint8Array[] = [];
        for (const p of pages) {
          const blob: Blob = await new Promise((r) => p.canvas.toBlob((b) => r(b!), 'image/png'));
          imgs.push(new Uint8Array(await blob.arrayBuffer()));
          alive();
        }
        off?.();
        off = api.onOcrProgress(({ page, progress, run: r }: any) => {
          if (r !== undefined && r !== run) return;
          const total = pages.length;
          const pct = ((si * total + page + progress) / (2 * total)) * 100;
          api.setProgress?.(pct / 100);
          setOcr((o) => (o.status === 'running' && ocrRun.current === run ? { ...o, pct, msg: t('正在识别{s}：第 {i}/{n} 页', { s: sideLabel(si as Side), i: page + 1, n: total }) } : o));
        });
        setOcr((o) => ({ ...o, msg: t('正在加载识别模型…') }));
        const res: any[] = await api.ocr({ images: imgs, langs, run });
        alive();
        const pagesOut: { text: string; conf: number; words: [string, number][] }[] = res.map((x) => (typeof x === 'string' ? { text: x, conf: -1, words: [] } : x));
        const full = pagesOut.map((x, i) => (pagesOut.length > 1 ? `—— ${t('第 {n} 页', { n: i + 1 })} ——\n` : '') + cleanOcr(x.text)).join('\n\n');
        texts.push(full);
        confs.push(pagesOut.map((x) => x.conf));
        lows.push(lowPositions(full, pagesOut.flatMap((x) => x.words || [])));
      }
      alive();
      setOcr({ status: 'done', a: texts[0], b: texts[1], key, conf: [confs[0], confs[1]], low: [lows[0], lows[1]] });
      api.notify?.(t('OCR 识别完成'), t('{a} 与 {b} 已可以比较', { a: A.file.name, b: B.file.name }));
      if (prefs.sound) chime('done');
    } catch (e: any) {
      if (ocrRun.current !== run) return; // 已被取消：取消时已经把状态复位了，别再写回
      const m = String(e?.message || e);
      setOcr(/取消/.test(m) ? { status: 'idle' } : { status: 'error', msg: m, key });
    } finally { off?.(); if (ocrRun.current === run) api.setProgress?.(-1); }
  };
  const cancelOcr = () => { const run = ocrRun.current; ocrRun.current++; api.ocrCancel?.(run); api.setProgress?.(-1); setOcr({ status: 'idle' }); flash(t('已取消识别')); };
  const lowWords = ocr.low;

  // ---------- 菜单 & 键盘 ----------
  const canCompare = !!(A && B) && !busy[0] && !busy[1];
  const startCompare = () => { if (canCompare) { setCompared(true); setTab(0); setChangedSides([]); } };
  const clearAll = () => { setDocs([null, null]); setCompared(false); setErrs([null, null]); ocrRun.current++; setOcr({ status: 'idle' }); setChangedSides([]); setLostBanner(null); lastLoaded.current = null; };
  const swap = () => { setDocs(([a, b]) => [b, a]); ocrRun.current++; setOcr({ status: 'idle' }); };
  const actions = useRef<any>({});
  actions.current = { open, swap, clearAll, go, decide, setTab, startCompare, compared, tab, selCid, modal: !!(pwd || pasteSide !== null || showSettings || exportOpen) };
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
      if (a.modal || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || modPressed(e) || e.altKey) return;
      if (!a.compared) { if (e.key === 'Enter' && t.tagName !== 'BUTTON') a.startCompare(); return; }
      const k = e.key.toLowerCase();
      if (k === 'j') { a.go(1); e.preventDefault(); }
      else if (k === 'k') { a.go(-1); e.preventDefault(); }
      else if (a.tab === 2) {
        if (k === 'a' || k === 'y') a.decide(a.selCid, 'a');
        else if (k === 'r') a.decide(a.selCid, 'r');
        else if (k === 'h') a.decide(a.selCid, 'h');
        else if (k === 'u') a.decide(a.selCid, null);
        else if (k === 'n') { e.preventDefault(); noteRef.current?.focus(); }
        else if (e.key === 'ArrowRight') a.go(1);
        else if (e.key === 'ArrowLeft') a.go(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const settingsValues: SettingsValues = {
    lang, theme, paperFollowTheme: prefs.paperFollowTheme, sound: prefs.sound, celebrate: prefs.celebrate,
    reviewerName: prefs.reviewerName, reviewerInitials: prefs.reviewerInitials, authorName: prefs.authorName, commentAccepted: prefs.commentAccepted,
    riskMoney: prefs.riskMoney, riskDate: prefs.riskDate, keywords: prefs.keywords, autoCheckUpdate: prefs.autoCheckUpdate,
  };
  const setSetting = <K extends keyof SettingsValues>(k: K, v: SettingsValues[K]) => {
    if (k === 'lang') return changeLang(v as Lang);
    if (k === 'theme') return setTheme(v as 'light' | 'dark');
    if (k === 'autoCheckUpdate') { set('autoCheckUpdate')(v as boolean); if (v) checkUpdate(false); return; }
    if (k === 'reviewerName') setPrefs((p) => ({ ...p, reviewerAsked: true }));
    setPrefs((p) => ({ ...p, [k]: v }));
  };

  const modals = (
    <>
      {pwd && <PasswordModal name={pwd.file.name} wrong={pwd.wrong} onCancel={() => setPwd(null)} onOk={(p) => { const x = pwd; setPwd(null); loadFile(x.side, x.file, p); }} />}
      {pasteSide !== null && <PasteModal side={pasteSide} onCancel={() => setPasteSide(null)} onOk={(t) => { const s = pasteSide; setPasteSide(null); loadFile(s, textFile(t, s)); }} />}
      {showSettings && <SettingsModal v={settingsValues} set={setSetting} onClose={() => setShowSettings(false)} initialTab={showSettings}
        upd={{ info: upd, checking: checkingUpd, onCheck: () => checkUpdate(true), onSkip: (v) => { set('skipVersion')(v); flash(t('已跳过 {v}，下次有更新的版本再提醒你', { v })); } }} />}
      {exportOpen && richRes && (
        <ExportDialog total={richRes.changes.length} undecided={richRes.changes.length - richRes.changes.filter((c) => decisions[c.id]?.v).length} risks={risks.length}
          author={expAuthor} setAuthor={setExpAuthor}
          reviewer={prefs.reviewerName} setReviewer={(v) => { setPrefs((p) => ({ ...p, reviewerName: v, reviewerInitials: initialsOf(v), reviewerAsked: true })); }}
          commentAccepted={prefs.commentAccepted} setCommentAccepted={set('commentAccepted')}
          hasSections={richRes.rows.some((r) => r.sec && r.sec !== 'body')}
          onExport={doExport} onHoldPending={() => decideAll('h', true)} onClose={() => setExportOpen(false)} busy={exportBusy} />
      )}
      {toast && <div className="toast" role="status" aria-live="polite">{toast}</div>}
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
    const missing = 2 - (A ? 1 : 0) - (B ? 1 : 0);
    return (
      <div className="app home">
        <div className="home-top drag">
          <Wordmark size={36} sub={t('离线文档比对')} />
          <div className="spacer" />
          <button className={`btn plain icon${updBadge ? ' has-dot' : ''}`} title={t(updBadge ? '设置（有新版本）' : '设置')} aria-label={t('设置')} onClick={() => setShowSettings('general')}><I.IconGear /></button>
        </div>
        <div className="home-scroll">
          <div className="home-inner">
            <div className="hero">
              <Mascot mood={A && B ? 'cheer' : A || B ? 'happy' : 'happy'} size={124} className="mascot-bob" />
              <div className="hero-text">
                <h1>{t(A && B ? '准备好了，开始比较吧' : '找出两份文档的每一处不同')}</h1>
                <p>{t('Word、PDF、TXT 任意组合 · 所有处理都在这台电脑上完成，不会上传')}</p>
                <div className="feats">
                  {MODES.slice(0, 5).map((m) => <span key={m.label} className={`feat mc-${m.c}`}>{m.icon}{t(m.label)}</span>)}
                  {!A && !B && <button className="btn sm sample-btn" onClick={trySample}>{t('用示例合同试一下')}</button>}
                </div>
              </div>
              <div className="bubble" aria-hidden="true">{t(A && B ? '两份都到齐了！按 Enter 就能开始。' : A || B ? '很好，再放一份进来。' : '把合同的两个版本拖进来，我帮你一处处找。')}</div>
            </div>
            <div className="drops">
              <DropZone side={0} doc={A} loading={busy[0]} error={errs[0]} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} onClear={() => setDocs((d) => [null, d[1]])} onPaste={() => setPasteSide(0)} />
              <div className="vs"><button className="vs-chip" title={t('交换左右')} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button></div>
              <DropZone side={1} doc={B} loading={busy[1]} error={errs[1]} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} onClear={() => setDocs((d) => [d[0], null])} onPaste={() => setPasteSide(1)} />
            </div>
            {recent.length > 0 && (
              <div className="recent">
                <h2><I.IconClock />{t('最近比较')}<span className="grow" />
                  <button className="btn sm plain" onClick={async () => { await api.recentClear?.(); setRecent([]); }}>{t('清空')}</button>
                </h2>
                <div className="recent-grid">
                  {recent.map((r, i) => {
                    const prog = r.a.sha && r.b.sha ? reviewProgress(pairKey(r.a.sha, r.b.sha)) : null;
                    return (
                      <div key={i} className="recent-item" role="button" tabIndex={0} onClick={() => openRecent(r)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRecent(r); } }}>
                        <div className="row"><span className={`badge ${r.a.ext}`}>{r.a.ext.toUpperCase()}</span><span className="name" title={r.a.name}>{midEllipsis(r.a.name)}</span></div>
                        <div className="row"><span className={`badge ${r.b.ext}`}>{r.b.ext.toUpperCase()}</span><span className="name" title={r.b.name}>{midEllipsis(r.b.name)}</span></div>
                        <div className="time">{timeAgo(r.time)}{prog && <><span className="mini-prog" aria-hidden="true"><i style={{ width: `${prog.total ? (prog.decided / prog.total) * 100 : 0}%` }} /></span><span className={`tag ${prog.decided >= prog.total ? 'brand' : 'hold'}`}>{prog.decided >= prog.total ? t('已审完') : t('已审 {d}/{n}', { d: prog.decided, n: prog.total })}</span></>}</div>
                        <button className="btn sm icon x" title={t('从列表移除')} aria-label={t('从列表移除')} onClick={(e) => { e.stopPropagation(); api.recentRemove(i).then(setRecent); }}><I.IconX /></button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="home-cta">
          {canCompare
            ? <><span className="hint">{t('也可以直接按')} <Kbd>Enter</Kbd></span><button className="btn primary big" onClick={startCompare}>{t('开始比较')}</button></>
            : <><span className="hint">{busy[0] || busy[1] ? t('正在读取文档…') : t('还差 {n} 个文档', { n: missing })}</span><button className="btn primary big" disabled>{t('开始比较')}</button></>}
        </div>
        {modals}
      </div>
    );
  }

  // =================== 比较界面 ===================
  const stats = curRes?.stats;
  const navCount = (i: number): [string | number, string] | undefined =>
    i === 0 && richRes ? [richRes.changes.length, t('含格式与移动的差异总数')]
    : i === 1 && plainRes ? [plainRes.changes.length, t('按行比较、不含格式，所以数字可能和富文本不同')]
    : i === 2 && richRes ? [`${richRes.changes.filter((c) => decisions[c.id]?.v).length}/${richRes.changes.length}`, t('已审阅 / 总数')]
    : i === 4 && ocrRes ? [ocrRes.changes.length, t('按识别出的文字逐行比较')]
    : undefined;

  const navBtns = shown.length > 0 && (
    <span className="nav-btns">
      <button className="btn sm" onClick={() => go(-1)} title={t('上一处（K）')}><I.IconUp />{t('上一处')}</button>
      <button className="btn sm" onClick={() => go(1)} title={t('下一处（J）')}><I.IconDown />{t('下一处')}</button>
    </span>
  );
  const navOpen = narrow ? navWide : prefs.navOpen;
  const filterNote = kindFilter.length > 0 && (
    <span className="tag outline lg">{t('只看：{k}', { k: kindFilter.map((k) => KIND_LABEL[k]).join(t('、')) })}<button type="button" className="tag-x" onClick={() => setKindFilter([])} title={t('清除筛选')} aria-label={t('清除筛选')}><I.IconX /></button></span>
  );

  // 中间工具条
  let tools: React.ReactNode = null;
  const asideShown = narrow ? drawer : prefs.asideOpen;
  const inlineLegend = !asideShown && stats && (tab === 0 || tab === 2) ? <Overview stats={stats} filter={kindFilter} setFilter={setKindFilter} compact /> : null;
  if (tab === 0) tools = (<>{inlineLegend}{filterNote}<span className="grow" />{navBtns}</>);
  else if (tab === 1) tools = (<><Seg value={prefs.layout} options={[['split', t('并排')], ['unified', t('合并')]]} onChange={set('layout')} label={t('布局')} />{filterNote}<span className="grow" />{navBtns}</>);
  else if (tab === 2) tools = changes.length === 0 ? null : (
    <>
      <div className="progress-lg" role="progressbar" aria-valuemin={0} aria-valuemax={changes.length} aria-valuenow={decidedCount} aria-label={t('审阅进度')}><div style={{ width: `${changes.length ? (decidedCount / changes.length) * 100 : 100}%` }} /></div>
      <span className="progress-label">{t('已审 {d}/{n}', { d: decidedCount, n: changes.length })}</span>
      {filterNote}
    </>
  );
  else if (tab === 3) tools = (
    <>
      <Seg value={prefs.imgMode} options={[['split', t('并排')], ['diff', t('差异')], ['fade', t('淡化')], ['slider', t('滑块')]]} onChange={set('imgMode')} label={t('对比方式')} />
      {prefs.imgMode === 'fade' && <><span className="progress-label">{t('原始')}</span><input type="range" className="range" style={{ width: 200 }} min={0} max={100} value={fade} onChange={(e) => setFade(Number(e.target.value))} aria-label={t('淡化程度')} /><span className="progress-label">{t('修改后')}</span></>}
      {prefs.imgMode === 'slider' && <span className="progress-label">{t('拖动页面上的分割线来对比')}</span>}
      <span className="grow" />
      <select className="sel" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title={t('缩放')} aria-label={t('缩放')}>
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
      </select>
    </>
  );
  else if (tab === 4) tools = (
    <>
      <select className="sel" value={prefs.ocrLang} onChange={(e) => set('ocrLang')(e.target.value as OcrLang)} disabled={ocr.status === 'running'} aria-label={t('识别语言')}>
        <option value="chi_sim+eng">{t('中文 + 英文')}</option><option value="chi_sim">{t('仅中文')}</option><option value="eng">{t('仅英文')}</option>
      </select>
      {ocr.status === 'running' ? <button className="btn sm danger-outline" onClick={cancelOcr}><I.IconX />{t('取消识别')}</button>
        : <button className="btn sm" onClick={runOcr}><I.IconOcr />{t(ocrRes ? '重新识别' : '开始识别')}</button>}
      {filterNote}<span className="grow" />{ocrRes && navBtns}
    </>
  );

  // 主体
  let body: React.ReactNode = null;
  const needsDiff = tab === 0 || tab === 1 || tab === 2 || (tab === 4 && !!ocrBlocks);
  const sameText = <div className="same-text">{t('在已比较的范围内未发现差异。')}{scope?.notCompared.length ? <small>{t('未比较：{x}', { x: scope.notCompared.join(t('、')) })}</small> : null}</div>;
  if (needsDiff && diffJob.running) body = (
    <div className="empty-state">
      <Mascot mood="think" size={96} />
      <h2>{t('正在比较…')}</h2>
      <div>{t('这份文档比较大，正在后台算，界面不会卡住。')}</div>
      <div className="progress indeterminate"><div /></div>
      <button className="btn sm plain" onClick={diffJob.cancel}>{t('取消比较')}</button>
    </div>
  );
  else if (needsDiff && diffJob.cancelled) body = (
    <div className="empty-state">
      <Mascot mood="sleepy" size={96} />
      <h2>{t('已取消比较')}</h2>
      <div>{t('可以调整一下比较设置再来一次。')}</div>
      <button className="btn primary" onClick={diffJob.retry}>{t('重新比较')}</button>
    </div>
  );
  else if (needsDiff && diffJob.error) body = (
    <div className="empty-state">
      <Mascot mood="oops" size={96} />
      <h2>{t('比较过程出错了')}</h2>
      <Notice tone="err" title={diffJob.error} />
      <button className="btn primary" onClick={diffJob.retry}>{t('重新比较')}</button>
    </div>
  );
  else if (tab === 0 && richRes && RA && RB) body = richRes.rows.length ? <RichView A={RA} B={RB} res={richRes} selCid={selCid} onSel={setSelCid} hideUnchanged={prefs.hideRich} />
    : <div className="empty-state"><Mascot mood="oops" size={96} /><h2>{t('没找到可以比较的文字')}</h2><div>{t((A.type === 'pdf' || B.type === 'pdf') ? '如果是扫描件，试试「OCR 文本」或「图像」模式。' : '两份文档好像都是空的。')}</div></div>;
  else if (tab === 1 && plainRes && plainBlocks) body = <PlainView A={plainBlocks[0]} B={plainBlocks[1]} res={plainRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} />;
  else if (tab === 2 && richRes && RA && RB) body = changes.length ? <RedlineView A={RA} B={RB} res={richRes} selCid={selCid} onSel={setSelCid} decisions={decisions} innerRef={redlineRef} />
    : <div className="empty-state"><Mascot mood="cheer" size={96} /><h2>{t('没有需要审阅的修订')}</h2>{sameText}</div>;
  else if (tab === 3) body = <ImageView state={imgState} mode={prefs.imgMode} zoom={zoom} fade={fade} setFade={setFade} slider={slider} setSlider={setSlider} showBoxes={prefs.showBoxes} onlyDiff={onlyDiffPages} scrollRef={imgScroll} />;
  else if (tab === 4) {
    if (ocrRes && ocrBlocks) body = <PlainView A={ocrBlocks[0]} B={ocrBlocks[1]} res={ocrRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} lowWords={lowWords} />;
    else if (ocr.status === 'running') body = <div className="empty-state"><Mascot mood="think" size={96} /><h2>{t('正在识别文字…')}</h2><div>{ocr.msg}</div><div className="progress"><div style={{ width: `${ocr.pct || 0}%` }} /></div><button className="btn sm plain" onClick={cancelOcr}>{t('取消')}</button></div>;
    else body = (
      <div className="empty-state">
        <Mascot mood="sleepy" size={96} />
        <h2>{t('先识别，再比较')}</h2>
        <div>{t('把两份文档的每一页当成图片来识别文字。适合扫描件、截图型 PDF。')}<br />{t('每页大约 3–5 秒，完全离线。')}</div>
        {ocr.status === 'error' && <Notice tone="err" title={t('识别失败')}>{ocr.msg}</Notice>}
        <button className="btn primary big" onClick={runOcr}>{t('开始识别')}</button>
      </div>
    );
  } else if (tab === 5) body = <DetailsView A={A} B={B} />;

  const showMap = (tab === 0 || tab === 1 || tab === 2 || (tab === 4 && !!ocrRes)) && shown.length > 0;
  const cur = changes.find((c) => c.id === selCid);
  const curIdx = changes.findIndex((c) => c.id === selCid);
  const curDec = cur ? decisions[cur.id] : undefined;
  const isRichTab = tab === 0 || tab === 2;

  // 右侧
  const asideActions = (curRes && changes.length > 0) || (isRichTab && richRes) ? (
    <div className="aside-actions">
      {richRes && isRichTab && <button className="btn primary sm" onClick={openExport}><I.IconExport />{t('导出…')}</button>}
      {curRes && <button className="btn sm" onClick={copySummary} title={t('复制为 Markdown，可粘贴到邮件 / 飞书 / 文档')}><I.IconCopy />{t('复制摘要')}</button>}
    </div>
  ) : null;
  const listTitle = t(tab === 2 ? '修订列表' : tab === 3 ? '页面' : '变更列表');
  const panelNames: Record<string, string> = { risk: t('需要留意'), overview: t('差异概览'), batch: t('批量处理'), list: listTitle, scope: t('比较范围与条件'), settings: t('比较设置'), visual: t('版面对比'), pages: t('页面'), conf: t('识别置信度') };
  const compareSettings = (
    <>
      <Opt label={t('忽略空白差异')} hint={t('多余空格、换行符不同')}><Switch on={prefs.ignoreWs} onChange={set('ignoreWs')} label={t('忽略空白差异')} /></Opt>
      <Opt label={t('忽略全角 / 半角标点')} hint={t('，和 ,　（和 (　视为相同')}><Switch on={prefs.normPunct} onChange={set('normPunct')} label={t('忽略全角 / 半角标点')} /></Opt>
      <Opt label={t('忽略大小写')}><Switch on={prefs.ignoreCase} onChange={set('ignoreCase')} label={t('忽略大小写')} /></Opt>
      <Opt label={t('检测移动的段落')}><Switch on={prefs.detectMoves} onChange={set('detectMoves')} label={t('检测移动的段落')} /></Opt>
      {isRichTab && <Opt label={t('检测格式变化')} hint={t(A.type !== B.type ? 'Word 与 PDF 互比时默认关闭' : '加粗、字号、颜色、标题级别')}><Switch on={formatting} onChange={setFormatting} label={t('检测格式变化')} /></Opt>}
      {tab === 0 && <Opt label={t('只看有变化的段落')}><Switch on={prefs.hideRich} onChange={set('hideRich')} label={t('只看有变化的段落')} /></Opt>}
      {(tab === 1 || tab === 4) && <><Opt label={t('只看有变化的行')}><Switch on={prefs.hidePlain} onChange={set('hidePlain')} label={t('只看有变化的行')} /></Opt><Opt label={t('自动换行')}><Switch on={prefs.wrap} onChange={set('wrap')} label={t('自动换行')} /></Opt></>}
      <Opt label={t('比较精度')}><Seg value={prefs.precision} options={[['word', t('按词')], ['char', t('按字符')]]} onChange={set('precision')} label={t('比较精度')} /></Opt>
    </>
  );
  const clearFilter = kindFilter.length > 0 && <button type="button" className="link-btn" onClick={() => setKindFilter([])}>{t('清除筛选')}</button>;
  let aside: React.ReactNode = null;
  let ocrConf: React.ReactNode = null;
  if (tab === 4 && ocr.status === 'done' && ocr.conf) {
    const avg = (xs: number[]) => { const v = xs.filter((x) => x >= 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : -1; };
    const lowConf = [...ocr.conf[0], ...ocr.conf[1]].some((c) => c >= 0 && c < 80);
    ocrConf = (
      <Panel id="conf" title={t('识别置信度')}>
        {[0, 1].map((s) => (
          <div className="conf-row" key={s}>
            <span>{sideLabel(s as Side)}</span>
            <span className="conf-pages">{ocr.conf![s].map((c, i) => <span key={i} className={`tag sm ${c < 0 ? '' : c < 80 ? 'hold' : 'brand'}`} title={t('第 {n} 页：{c}%', { n: i + 1, c: c < 0 ? '—' : Math.round(c) })}>{c < 0 ? '—' : Math.round(c)}</span>)}</span>
            <b>{avg(ocr.conf![s]) < 0 ? '—' : `${avg(ocr.conf![s])}%`}</b>
          </div>
        ))}
        {lowConf && <Notice tone="warn" className="in-panel">{t('有页面识别把握不高，结果仅供参考。虚线标出的是没认准的字。')}</Notice>}
      </Panel>
    );
  }
  if (tab === 0 || tab === 1 || tab === 2 || tab === 4) {
    aside = (
      <>
        {asideActions}
        <PanelGroup state={panels} names={panelNames}>
          {isRichTab && risks.length > 0 && (
            <Panel id="risk" tone="warn" icon={<I.IconWarn />} title={t('需要留意')} count={risks.length}>
              <RiskList risks={risks} changes={changeById} clauses={clauses} onSel={setSelCid} sel={selCid} />
            </Panel>
          )}
          {curRes && (
            <Panel id="overview" title={t('差异概览')} count={changes.length || undefined} right={clearFilter}>
              {changes.length === 0 ? <Notice tone="ok" className="in-panel" title={t('在已比较的范围内未发现差异。')}>{scope?.notCompared.length ? t('未比较：{x}', { x: scope.notCompared.join(t('、')) }) : null}</Notice>
                : <Overview stats={stats!} filter={kindFilter} setFilter={setKindFilter} />}
            </Panel>
          )}
          {tab === 2 && changes.length > 0 && (
            <Panel id="batch" title={t('批量处理')}>
              <div className="batch">
                <button className="btn sm" onClick={() => decideAll('a')}><I.IconCheck />{t('全部接受')}</button>
                <button className="btn sm danger" onClick={() => decideAll('r')}><I.IconX />{t('全部拒绝')}</button>
              </div>
              {decidedCount > 0 && <button className="btn sm plain block" style={{ marginTop: 8 }} onClick={() => decideAll(null)}>{t('重置所有决定')}</button>}
            </Panel>
          )}
          {changes.length > 0 && (
            <Panel id="list" grow title={listTitle} count={kindFilter.length ? `${shown.length}/${changes.length}` : changes.length} right={clearFilter}>
              <ChangeList changes={shown} all={changes} sel={selCid} onSel={setSelCid} decisions={tab === 2 ? decisions : undefined} clauses={isRichTab ? clauses : noClauses} risks={isRichTab ? riskById : new Map()} grouped={isRichTab} />
            </Panel>
          )}
          {ocrConf}
          {isRichTab && scope && (
            <Panel id="scope" icon={<I.IconCheck />} title={t('比较范围与条件')} count={scope.degraded ? <span className="tag hold sm">{t('简化对齐')}</span> : undefined}>
              <ScopeBody scope={scope} />
            </Panel>
          )}
          <Panel id="settings" icon={<I.IconGear />} title={t('比较设置')}>
            <div>{compareSettings}</div>
          </Panel>
        </PanelGroup>
      </>
    );
  } else if (tab === 3) {
    const diffPages = imgState.diffs.filter((d) => d.pct >= 0.001).length;
    aside = (
      <PanelGroup state={panels} names={panelNames}>
        <Panel id="visual" title={t('版面对比')}>
          {imgState.loading && !imgState.diffs.length ? <div className="progress-label">{imgState.loading}</div> : diffPages ? (
            <div className="page-stats"><div className="ps diff"><b>{diffPages}</b><span>{t('页有差异')}</span></div><div className="ps same"><b>{imgState.diffs.length - diffPages}</b><span>{t('页相同')}</span></div></div>
          ) : <Notice tone="ok" className="in-panel" title={t('每一页在视觉上都没有发现差异。')} />}
          <div style={{ marginTop: 8 }}>
            <Opt label={t('标出差异区域')}><Switch on={prefs.showBoxes} onChange={set('showBoxes')} label={t('标出差异区域')} /></Opt>
            <Opt label={t('只看有差异的页')}><Switch on={onlyDiffPages} onChange={setOnlyDiffPages} label={t('只看有差异的页')} /></Opt>
            <Opt label={t('灵敏度')}>
              <select className="sel" value={prefs.threshold} onChange={(e) => set('threshold')(Number(e.target.value))} aria-label={t('灵敏度')}>
                <option value={0.03}>{t('很高')}</option><option value={0.1}>{t('标准')}</option><option value={0.2}>{t('较低')}</option><option value={0.35}>{t('低')}</option>
              </select>
            </Opt>
          </div>
        </Panel>
        <Panel id="pages" grow title={t('页面')} count={imgState.diffs.length || undefined}>
          <div className="pagelist">
            {imgState.diffs.map((d, i) => (
              <button key={i} onClick={() => document.getElementById(`page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                <span><span className={`dot ${d.pct < 0.001 ? 'same' : 'diff'}`} />{t('第 {n} 页', { n: i + 1 })}</span>
                <span className="muted">{d.aMissing || d.bMissing ? t('缺页') : d.pct < 0.001 ? t('相同') : `${d.pct < 0.01 ? '<0.01' : d.pct.toFixed(2)}%`}</span>
              </button>
            ))}
          </div>
          <div className="caption">{t('Word 和 TXT 会先在本机排成页面再比较，分页可能和 Word 略有不同。')}</div>
        </Panel>
      </PanelGroup>
    );
  }

  const asideOpen = (narrow ? drawer : prefs.asideOpen) && !!aside;
  const toggleNav = () => (narrow ? setNavWide((v) => !v) : set('navOpen')(!prefs.navOpen));
  const toggleAside = () => (narrow ? setDrawer((v) => !v) : set('asideOpen')(!prefs.asideOpen));
  const crossFormat = A.type !== B.type && (A.type === 'pdf' || B.type === 'pdf') && isRichTab && dismissCross !== docSig;
  const askReviewer = tab === 2 && changes.length > 0 && !prefs.reviewerAsked;

  return (
    <div className={`app shell ${aside ? '' : 'no-aside'} ${navOpen ? '' : 'nav-mini'} ${asideOpen ? '' : 'aside-off'} ${showMap ? 'has-map' : ''} ${narrow ? 'narrow' : ''}`}>
      <nav className="nav" aria-label={t('比较模式')}>
        <div className="nav-drag drag" />
        <div className="nav-brand drag"><Wordmark size={34} /></div>
        {MODES.map((m, i) => {
          const n = navCount(i);
          return (
            <button key={i} className={`nav-item mc-${m.c} ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)} title={`${t(m.label)}（${kbd(`mod+${i + 1}`)}）${n ? ' · ' + n[1] : ''}`} aria-current={tab === i ? 'page' : undefined}>
              {m.icon}<span>{t(m.label)}</span>{n !== undefined && <span className="count">{n[0]}</span>}
            </button>
          );
        })}
        <div className="spacer" />
        <div className="nav-foot">
          <button className="nav-item" onClick={clearAll} title={t('新建比较')}><I.IconPlusDoc /><span>{t('新建比较')}</span></button>
          <button className="nav-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t(theme === 'dark' ? '浅色模式' : '深色模式')}>{theme === 'dark' ? <I.IconSun /> : <I.IconMoon />}<span>{t(theme === 'dark' ? '浅色模式' : '深色模式')}</span></button>
          <button className={`nav-item${updBadge ? ' has-dot' : ''}`} onClick={() => setShowSettings('general')} title={t(updBadge ? '设置（有新版本）' : '设置')}><I.IconGear /><span>{t('设置')}</span></button>
        </div>
      </nav>

      <button className="edge-handle left" onClick={toggleNav} title={t(navOpen ? '收起左侧栏' : '展开左侧栏')} aria-label={t(navOpen ? '收起左侧栏' : '展开左侧栏')} aria-expanded={navOpen}>{navOpen ? <I.IconChevronLeft /> : <I.IconChevronRight />}</button>
      {aside && <button className="edge-handle right" onClick={toggleAside} title={t(asideOpen ? '收起右侧栏' : '展开右侧栏')} aria-label={t(asideOpen ? '收起右侧栏' : '展开右侧栏')} aria-expanded={asideOpen}>{asideOpen ? <I.IconChevronRight /> : <I.IconChevronLeft />}</button>}

      <main className="center">
        <div className="center-head drag">
          <FilePill side={0} doc={A} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} changed={changedSides.includes(0)} />
          <button className="vs-chip" title={t('交换左右（{k}）', { k: kbd('mod+shift+S') })} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button>
          <FilePill side={1} doc={B} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} changed={changedSides.includes(1)} />
          {(busy[0] || busy[1]) && <div className="spinner" style={{ width: 22, height: 22, borderWidth: 3 }} />}
        </div>
        {changedSides.length > 0 && (
          <Notice className="bar" title={t('「{f}」刚刚在磁盘上被修改了', { f: changedSides.map((s) => docs[s]?.file.name).join('」/「') })}
            action={<button className="btn sm" onClick={reloadChanged}>{t('重新比较')}</button>} onClose={() => setChangedSides([])} closeLabel={t('忽略')} />
        )}
        {lostBanner && (
          <Notice tone="warn" className="bar" title={t('{n} 个决定对不上了。', { n: lostBanner.n })}
            action={<button className="btn sm" onClick={lostBanner.restore}>{t('改回原来的设置')}</button>} onClose={() => setLostBanner(null)}>
            {t('比较设置改过了。这些决定已经保存，改回原来的设置就会回来。')}
          </Notice>
        )}
        {crossFormat && (
          <Notice className="bar" role="note" title={t('跨格式比对。')}
            action={!formatting && <button className="btn sm" onClick={() => setFormatting(true)}>{t('检测格式差异')}</button>} onClose={() => setDismissCross(docSig)}>
            {t('PDF 的文字是从版面推断的，段落和表格可能被拆开。')}{formatting ? t('格式差异已检测，但 PDF 的格式信息不完整。') : t('格式差异（加粗、字号等）没有检测。')}
          </Notice>
        )}
        {(errs[0] || errs[1]) && <Notice tone="err" className="bar" title={errs[0] || errs[1]} />}
        {tools && <div className="center-tools">{tools}</div>}
        <div className="center-body">
          <div className="main">
            {curRes?.degraded && !dismissDegraded && (
              <Notice tone="warn" className="in-main" title={t('这次用了简化的段落对齐')} onClose={() => setDismissDegraded(true)}>
                {curRes.degraded.pairFallback
                  ? t('两份文档差异太大（单个区段 {n} 组比较），为了不卡死改用了按位置粗配，段落对应关系可能不准。', { n: curRes.degraded.maxRegion.toLocaleString() })
                  : t('差异区段过大，本次没有识别段落的拆分与合并。')}
              </Notice>
            )}
            {body}
            {showMap && <ChangeMap bottom={tab === 2 ? (askReviewer ? 160 : 118) : 6} changes={changes} filter={kindFilter} selCid={selCid} onSel={setSelCid} dep={[curRes, tab, prefs.hideRich, prefs.hidePlain, prefs.layout, prefs.wrap, decisions, asideOpen, navOpen]} />}
            {askReviewer && (
              <div className="reviewer-ask" role="note">
                <span className="chip"><span className="av">{(prefs.reviewerInitials || initialsOf(reviewer)).slice(0, 2)}</span>{reviewer}</span>
                {editName === null ? (
                  <>
                    <span className="grow">{t('你将以「{n}」的身份审阅。每个决定都会在导出的 Word 里署这个名字。', { n: reviewer })}</span>
                    <button className="btn sm" onClick={() => setEditName(prefs.reviewerName)}>{t('改名字')}</button>
                    <button className="btn sm primary" onClick={() => set('reviewerAsked')(true)}>{t('好的')}</button>
                  </>
                ) : (
                  <>
                    <input className="grow" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('审阅人姓名')}
                      onKeyDown={(e) => { if (e.key === 'Enter' && editName.trim()) { setPrefs((p) => ({ ...p, reviewerName: editName.trim(), reviewerInitials: initialsOf(editName.trim()), reviewerAsked: true })); setEditName(null); } if (e.key === 'Escape') setEditName(null); }} />
                    <button className="btn sm primary" disabled={!editName.trim()} onClick={() => { setPrefs((p) => ({ ...p, reviewerName: editName.trim(), reviewerInitials: initialsOf(editName.trim()), reviewerAsked: true })); setEditName(null); }}>{t('保存')}</button>
                  </>
                )}
              </div>
            )}
            {tab === 2 && changes.length > 0 && (
              <div className={`review-bar ${feedback ? 'fb-' + feedback : ''}`}>
                <div className="rb-top">
                  {feedback ? (
                    <span className="fb" role="status">{feedback === 'a' ? <I.IconCheck /> : feedback === 'r' ? <I.IconX /> : <I.IconWarn />}{t(VERDICT_FB[feedback])}</span>
                  ) : cur ? (
                    <span className="t">
                      <span className={`tag ${cur.kind}`}>{KIND_LABEL[cur.kind]}</span>
                      {t('第 {i} / {n} 处', { i: curIdx + 1, n: changes.length })}
                      <span className="rb-where">{cur.sec && cur.sec !== 'body' ? t(cur.sec === 'header' ? '页眉' : cur.sec === 'footer' ? '页脚' : '脚注') : clauses.get(cur.id) ?? t('开头部分')}</span>
                      {riskById.get(cur.id) && <span className="tag hold">{t('需要留意')}</span>}
                      {curDec?.v && <span className={`tag ${curDec.v === 'a' ? 'brand' : curDec.v === 'r' ? 'del' : 'hold'}`}>{t(VERDICT_SHORT[curDec.v])}{curDec.by ? ` · ${curDec.by}` : ''}</span>}
                    </span>
                  ) : <span className="t">{t('点文中任意一处修订开始审阅')}</span>}
                  <span className="grow" />
                  <button className="chip as-btn" onClick={() => setShowSettings('review')} title={t('审阅人：{n}（点击修改）', { n: reviewer })}><span className="av">{(prefs.reviewerInitials || initialsOf(reviewer)).slice(0, 2)}</span>{reviewer}</button>
                </div>
                {cur && <div className="rb-diff">{cur.kind === 'mod' ? <><del>{short(cur.before, 60)}</del><span className="arrow">→</span><ins>{short(cur.after, 60)}</ins></> : cur.kind === 'ins' ? <ins>{short(cur.after, 120)}</ins> : cur.kind === 'del' ? <del>{short(cur.before, 120)}</del> : cur.kind === 'fmt' ? <>{short(cur.before, 60)}<em>（{noteText(cur)}）</em></> : <>{short(cur.before, 100)}<em>（{t('整段移动')}）</em></>}</div>}
                <div className="rb-acts">
                  <label className="rb-note">
                    <Kbd>N</Kbd>
                    <input id="note-input" ref={noteRef} disabled={!cur} value={cur ? decisions[cur.id]?.note || '' : ''} placeholder={t('备注（可选），会写进 Word 批注')}
                      onChange={(e) => cur && setNote(cur.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} aria-label={t('备注')} />
                  </label>
                  <span className="keys"><Kbd>R</Kbd>{t('拒绝')} <Kbd>H</Kbd>{t('待议')} <Kbd>A</Kbd>{t('接受')}</span>
                  <button className="btn red" disabled={!cur} onClick={() => decide(selCid, 'r')}>{t('拒绝')}</button>
                  <button className="btn hold" disabled={!cur} onClick={() => decide(selCid, 'h')}>{t('待议')}</button>
                  <button className="btn primary" disabled={!cur} onClick={() => decide(selCid, 'a')}>{t('接受')}</button>
                </div>
              </div>
            )}
            {tab === 2 && doneOpen && (
              <div className="overlay-bg">
                {prefs.celebrate && <Confetti />}
                <div className="done-card" role="dialog" aria-label={t('审阅完成')}>
                  <Mascot mood="cheer" size={120} className="mascot-pop" />
                  <h2>{t('审阅完成')}</h2>
                  <div className="muted">{t('{n} 处修订全部处理完毕', { n: changes.length })}</div>
                  <div className="done-stats">
                    {(['a', 'r', 'h'] as Verdict[]).map((v) => <div key={v} className={`done-stat ${v}`}><div className="h">{t(v === 'a' ? '接受' : v === 'r' ? '拒绝' : '待议')}</div><div className="v">{changes.filter((c) => decisions[c.id]?.v === v).length}</div></div>)}
                  </div>
                  <div className="done-acts">
                    <button className="btn primary big block" onClick={() => { setDoneOpen(false); openExport(); }}><I.IconExport />{t('导出审阅结果…')}</button>
                    <button className="btn plain block" onClick={() => setDoneOpen(false)}>{t('回去再看看')}</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {aside && asideOpen && <aside className={`aside ${narrow ? 'drawer' : ''}`} aria-label={t('差异与设置')}><div className="aside-drag drag" />{aside}</aside>}
      {aside && asideOpen && narrow && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}
      {modals}
    </div>
  );
}
