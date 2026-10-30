import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DocModel, FileInfo } from './lib/model';
import { compareBlocks, docPlainText, fmtBytes } from './lib/model';
import { loadDoc } from './lib/load';
import { NeedPassword } from './lib/pdf';
import { linesToBlocks, DiffOptions, DiffResult, Change, ChangeKind } from './lib/engine';
import { buildDocx } from './lib/exportDocx';
import { forEachPage, getPageCount, PageRange, BIG_PAGES, fullRange, rangeKey, clearPageCaches } from './lib/pages';
import { PageRangeGate, RangeLine, RangeProgress } from './components/PageRangeGate';
import { kbd, modPressed, isMac } from './lib/platform';
import { t, setLang, initLang, Lang } from './lib/i18n';
import { clauseMap, detectRisks, DEFAULT_KEYWORDS, Risk } from './lib/insight';
import { DecMap, Dec, Verdict, pairKey, loadDecisions, saveDecisions, reviewProgress, initialsOf } from './lib/review';
import { scopeInfo, pageList } from './lib/scope';
import { getSetting, setSetting as saveSetting, usePersistStatus } from './lib/persist';
import { summaryMarkdown, reportHtml } from './lib/report';
import { ChangeList, KIND_LABEL, short } from './components/ChangeList';
import { ChangeMap } from './components/ChangeMap';
import { FilterChips, Filter, ScopeBody, scopeLine } from './components/Panels';
import { Notice } from './components/Panel';
import { Popover, MenuItem } from './components/Popover';
import { ExportDialog, ExportKind } from './components/ExportDialog';
import { SettingsModal, SettingsValues, UpdInfo, APP_VERSION, type Tab as SettingsTab } from './components/SettingsModal';
import { Modal } from './components/Modal';
import { Mascot, Confetti } from './components/Mascot';
import { Wordmark } from './components/Logo';
import { Switch, Opt, Seg, Kbd, useMedia, splitName, MidName, TypeTag } from './components/ui';
import * as I from './components/icons';
import { RichView } from './views/RichView';
import { PlainView } from './views/PlainView';
import { RedlineView } from './views/RedlineView';
import { ImageView, ImgMode, useImagePages } from './views/ImageView';
import { DetailsView } from './views/DetailsView';
import { noteText, riskTag } from './lib/describe';
import { useDiff } from './lib/useDiff';
import { useDrop } from './lib/drop';
import { buildPlan } from './lib/draft/plan';
import { DraftSync, cleanStem, type DraftState } from './lib/draft/client';
import { DraftChip, REASON } from './components/DraftChip';
import { TemplatesCard, TemplateCompareDialog, MatchNotice, RecentRow } from './components/Library';
import { ThreadsCard, VersionChip, AddVersionDialog, HintLine, ClauseHistory } from './components/Thread';
import { hintsFor, clauseHistory } from './lib/hints';
import { type Library, type Template, type TplVersion, type Thread, type ThreadVersion, type Side as LibSide, type Round, EMPTY_LIB, loadLibrary, loadRounds, saveLibrary, putFile, readVersion, fingerprint, pick, versionLabel, stemOf, live, uid, UNDO_MS, defaultPair, roundOf, matchThreads } from './lib/library';

const api = (window as any).api;
type Side = 0 | 1;
const sideLabel = (s: Side) => t(s ? '修改后文档' : '原始文档');
// 每个模式有自己的颜色：侧栏的模式图标、首页功能图标都用它
const MODES = [
  { label: '富文本', icon: <I.ModeRich />, g: <I.GlyphRich />, c: 'macaw' },
  { label: '纯文本', icon: <I.ModePlain />, g: <I.GlyphPlain />, c: 'wolf' },
  { label: '修订审阅', icon: <I.ModeRedline />, g: <I.GlyphRedline />, c: 'bee' },
  { label: '图像', icon: <I.ModeImage />, g: <I.GlyphImage />, c: 'feather' },
  { label: 'OCR 文本', icon: <I.ModeOcr />, g: <I.GlyphOcr />, c: 'beetle' },
  { label: '文件详情', icon: <I.ModeDetails />, g: <I.GlyphDetails />, c: 'fox' },
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
  // 1.8：审阅稿、定稿的文件名，{name} = 对方文件名
  draftName: string; finalName: string;
  /** 以前的审阅稿被删了或挪走了：自动重新生成 / 先问我（beta.6） */
  draftMissing: 'auto' | 'ask';
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
  draftName: '', finalName: '', draftMissing: 'auto',
};
function loadPrefs(): Prefs {
  try { const v = getSetting('prefs-v2'); return { ...DEFAULT_PREFS, ...(typeof v === 'string' ? JSON.parse(v) : v || {}) }; } catch { return DEFAULT_PREFS; }
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

// ---------- 拖放（1.8 起放在 lib/drop.ts，弹窗里也能拖） ----------
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

function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('刚刚');
  if (s < 3600) return t('{n} 分钟前', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} 小时前', { n: Math.floor(s / 3600) });
  if (s < 86400 * 7) return t('{n} 天前', { n: Math.floor(s / 86400) });
  return new Date(ts).toLocaleDateString();
}

// ---------- 首页组件 ----------
function DropZone({ side, doc, loading, error, onOpen, onFiles, onClear, onPaste, compact }: {
  side: Side; doc: DocModel | null; loading: boolean; error: string | null;
  onOpen: () => void; onFiles: (f: FileInfo[]) => void; onClear: () => void; onPaste: () => void;
  /** 老用户首页（beta.7 · H）：一行写清是哪一边 + 两个按钮，约 88 高；整块照旧能拖放 */
  compact?: boolean;
}) {
  const d = useDrop(onFiles);
  if (compact) return (
    <div className={`drop compact ${d.over ? 'over' : ''} ${doc ? 'filled' : ''}`} {...d.props}>
      <div className="dz-txt">
        <div className="label">{sideLabel(side)}</div>
        {loading ? <div className="title muted">{t('正在读取…')}</div>
          : doc ? <div className="title file"><TypeTag type={doc.type} /><MidName name={doc.file.name} /></div>
          : <div className="title">{side ? t('拖入对方发来的文件') : t('拖入 Word、PDF 或 TXT')}</div>}
        {doc && !loading && <div className="sub">{docStat(doc)} · {t('{n} 段', { n: doc.blocks.filter((b) => b.kind === 'tr' || b.runs.length).length })}</div>}
      </div>
      {loading ? <div className="spinner sm" /> : doc ? (
        <div className="acts"><button className="btn sm" onClick={onOpen}><I.IconUpload />{t('更换')}</button><button className="btn sm plain" onClick={onClear}>{t('移除')}</button></div>
      ) : (
        <div className="acts"><button className="btn sm blue" onClick={onOpen}><I.IconUpload />{t('选择文件')}</button><button className="btn sm" onClick={onPaste}><I.IconPaste />{t('粘贴')}</button></div>
      )}
      {doc?.type === 'pdf' && doc.blocks.length === 0 && <Notice tone="warn" className="stack dz-note" title={t('没读到文字，可能是扫描件。')}>{t('比较后用「OCR 文本」或「图像」模式。')}</Notice>}
      {error && <Notice tone="err" className="stack dz-note" title={error} />}
    </div>
  );
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


/** 文件片（规范 3.0）：工具栏左侧，高 36。点一下换文件，也可以直接把文件拖上来替换 */
function FilePill({ side, doc, onOpen, onFiles, changed }: { side: Side; doc: DocModel; onOpen: () => void; onFiles: (f: FileInfo[]) => void; changed: boolean }) {
  const d = useDrop(onFiles);
  return (
    <button type="button" className={`filechip ${d.over ? 'over' : ''}`} {...d.props} onClick={onOpen}
      title={`${doc.file.path || doc.file.name}\n${t('点一下换一个文件，也可以直接拖进来')}`} aria-label={`${sideLabel(side)}：${doc.file.name}。${t('换一个文件')}`}>
      <span className={`badge ${doc.type}`}>{doc.type.toUpperCase()}</span>
      <span className="who">{t(side ? '修改后' : '原始')}</span>
      <span className="name">{(() => { const [h, tl] = splitName(doc.file.name); return <><span className="fn-h">{h}</span><span className="fn-t">{tl}</span></>; })()}</span>
      {changed && <span className="chg-dot" title={t('已更新')} />}
    </button>
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
interface OcrState { status: 'idle' | 'running' | 'done' | 'error'; msg?: string; pct?: number; done?: number; n?: number; stopped?: boolean; a?: string; b?: string; key?: string; conf?: [number[], number[]]; low?: [Map<number, Set<number>>, Map<number, Set<number>>] }
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
  const [showSettings, setShowSettings] = useState<false | SettingsTab>(false);
  const [lang, setLangState] = useState<Lang>(initLang);
  const [compared, setCompared] = useState(false);
  const [tab, setTab] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const t = getSetting('theme'); if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  const [toast, setToast] = useState<string | null>(null);
  const changeLang = (l: Lang) => { setLang(l); setLangState(l); api.setLang?.(l); };
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const [formatting, setFormatting] = useState(true);
  const [recent, setRecent] = useState<any[]>([]);
  const [changedSides, setChangedSides] = useState<Side[]>([]);
  const [selCid, setSelCid] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<DecMap>({});
  const [feedback, setFeedback] = useState<Verdict | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  // 批量操作先确认，做完可撤销（1.7.3）
  const [bulkAsk, setBulkAsk] = useState<null | 'a' | 'r' | 'reset'>(null);
  const [undoToast, setUndoToast] = useState<null | { msg: string; obj?: string; undo: () => void }>(null);
  const undoTimer = useRef<any>(0);
  /** 删除模板 / 往来稿后真正清掉的计时器，和撤销提示的计时器分开：中途做别的批量操作不会把清理取消掉 */
  const purgeTimer = useRef<any>(0);
  const [dismissDegraded, setDismissDegraded] = useState(false);
  const [dismissCross, setDismissCross] = useState('');
  const persist = usePersistStatus();
  const [hideSetWarn, setHideSetWarn] = useState('');
  const [hideReadWarn, setHideReadWarn] = useState('');
  const [lostBanner, setLostBanner] = useState<{ n: number; restore: () => void } | null>(null);
  const [upd, setUpd] = useState<UpdInfo | null>(null);
  const [checkingUpd, setCheckingUpd] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [expAuthor, setExpAuthor] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [pop, setPop] = useState<null | 'settings' | 'scope' | 'more'>(null);
  const closePop = useCallback(() => setPop(null), []);
  const gearRef = useRef<HTMLButtonElement>(null), scopeRef = useRef<HTMLButtonElement>(null), moreRef = useRef<HTMLButtonElement>(null);
  const [editName, setEditName] = useState<string | null>(null);
  const [fade, setFade] = useState(50);
  const [slider, setSlider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [onlyDiffPages, setOnlyDiffPages] = useState(false);
  const [ocr, setOcr] = useState<OcrState>({ status: 'idle' });
  const ocrRun = useRef(0);
  // 图像 / OCR 的页码范围（1.7.3）：按“两份文件”记住用户的选择；超过 300 页时先确认
  const [pageRanges, setPageRanges] = useState<Record<string, PageRange>>({});
  const [pageCounts, setPageCounts] = useState<{ key: string; a: number; b: number } | null>(null);
  const decideOrder = useRef<number[]>([]);
  const imgScroll = useRef<HTMLDivElement>(null);
  const redlineRef = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLInputElement>(null);
  const narrow = useMedia('(max-width: 1180px)');
  const [navWide, setNavWide] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const toggleNav = () => (narrow ? setNavWide((v) => !v) : setPrefs((p) => ({ ...p, navOpen: !p.navOpen })));
  const toggleAside = () => (narrow ? setDrawer((v) => !v) : setPrefs((p) => ({ ...p, asideOpen: !p.asideOpen })));

  useEffect(() => { document.documentElement.dataset.theme = theme; saveSetting('theme', theme); api.setTheme?.(theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.paper = prefs.paperFollowTheme ? 'theme' : 'light'; }, [prefs.paperFollowTheme]);
  useEffect(() => { saveSetting('prefs-v2', prefs); }, [prefs]);
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
  // ---------- 模板（1.8） ----------
  const [lib, setLib] = useState<Library>(EMPTY_LIB);
  const libRef = useRef(lib); libRef.current = lib;
  const [libBusy, setLibBusy] = useState(false);
  const [tplDlg, setTplDlg] = useState<string | null>(null);
  const [matchOff, setMatchOff] = useState<string>('');
  useEffect(() => { if (!compared) loadLibrary().then(setLib); }, [compared]);
  // ---------- 往来稿（1.8 M3） ----------
  const [thread, setThread] = useState<{ id: string; a: string; b: string } | null>(null);
  const [addVer, setAddVer] = useState<{ id: string; f: FileInfo | null } | null>(null);
  const [pendingSave, setPendingSave] = useState(false);
  const activeTh = thread ? lib.threads.find((x) => x.id === thread.id && !x.deleted) || null : null;
  const loadPair = async (va: { file: any; orig?: string }, vb: { file: any; orig?: string } | FileInfo, bIsFile = false) => {
    const fa = await readVersion(va);
    const fb = bIsFile ? (vb as FileInfo) : await readVersion(vb as any);
    if (!fa || !fb) { flash(t('往来稿里的文件不见了')); return false; }
    await Promise.all([loadFile(0, fa), loadFile(1, fb)]);
    return true;
  };
  const openThread = async (th: Thread, a?: ThreadVersion, b?: ThreadVersion) => {
    const vs = th.versions;
    const dp = !a && !b ? defaultPair(th) : null;
    const vb = b || dp?.b || vs[vs.length - 1], va = a || dp?.a || vs[vs.indexOf(vb) - 1];
    if (!va || !vb) { flash(t('这份往来稿只有一版，加入新版本后才能比较')); return; }
    setThread(null);
    if (!(await loadPair(va, vb))) return;
    setThread({ id: th.id, a: va.id, b: vb.id });
    setCompared(true); setTab(2);
  };
  const updThread = (id: string, f: (th: Thread) => Thread) => commitLib({ ...libRef.current, threads: libRef.current.threads.map((x) => (x.id === id ? f(x) : x)) });
  // 记住这份往来稿上次比较的是哪一对（可能不相邻），首页再点它时回到这一对
  useEffect(() => {
    if (!thread) return;
    const th = libRef.current.threads.find((x) => x.id === thread.id);
    if (th && (th.last?.a !== thread.a || th.last?.b !== thread.b)) updThread(th.id, (x) => ({ ...x, last: { a: thread.a, b: thread.b } }));
  }, [thread?.id, thread?.a, thread?.b]);
  /** 把当前的一对文件存成往来稿：原始 = V1（我方），修改后 = V2（对方） */
  const saveAsThread = async (tplRef?: { tid: string; v: TplVersion }) => {
    if (!A || !B) return;
    // 这一对已经在某份往来稿里：直接进入，不重复建
    for (const th of live(libRef.current.threads)) {
      const va = th.versions.find((v) => v.file.sha === A.sha256), vb = th.versions.find((v) => v.file.sha === B.sha256);
      if (va && vb && th.versions.indexOf(va) < th.versions.indexOf(vb)) { setThread({ id: th.id, a: va.id, b: vb.id }); if (!tplRef) flash(t('这两份已经在往来稿「{n}」里了', { n: th.name })); return; }
    }
    try {
      const now = Date.now();
      const v1: ThreadVersion = tplRef
        ? { id: uid(), n: 1, side: 'ours', added: now, file: tplRef.v.file, fp: tplRef.v.fp, orig: tplRef.v.orig, tpl: { tid: tplRef.tid, vid: tplRef.v.id } }
        : { id: uid(), n: 1, side: 'ours', added: now, file: (A.file as any).lib ? { sha: A.sha256!, ext: A.file.ext, size: A.file.size, name: A.file.name, mtime: A.file.mtime } : await putFile(A.file.path), fp: fingerprint(A), orig: (A.file as any).lib ? undefined : A.file.path };
      const v2: ThreadVersion = { id: uid(), n: 2, side: 'theirs', added: now, file: (B.file as any).lib ? { sha: B.sha256!, ext: B.file.ext, size: B.file.size, name: B.file.name, mtime: B.file.mtime } : await putFile(B.file.path), fp: fingerprint(B), orig: (B.file as any).lib ? undefined : B.file.path };
      const th: Thread = { id: uid(), name: cleanStem(B.file.name), created: now, updated: now, versions: [v1, v2], rounds: [], tpl: tplRef ? { tid: tplRef.tid, vid: tplRef.v.id } : undefined };
      await commitLib({ ...libRef.current, threads: [...libRef.current.threads, th] });
      setThread({ id: th.id, a: v1.id, b: v2.id });
      if (!tplRef) flash(t('已存为往来稿「{n}」', { n: th.name }));
    } catch (e: any) { flash(t('没能存为往来稿：{e}', { e: String(e?.message || e) })); }
  };
  useEffect(() => { if (pendingSave && compared && A && B && !busy[0] && !busy[1]) { setPendingSave(false); saveAsThread(); } }, [pendingSave, compared, A, B, busy]);
  /** 加入新版本：拷进库、记指纹，然后和指定的一版比较 */
  const addThreadVersion = async (th: Thread, f: FileInfo, side: LibSide, against: string, loaded?: DocModel) => {
    try {
      const d = loaded || await loadDoc(f);
      const file = await putFile(f.path);
      if (th.versions.some((v) => v.file.sha === file.sha)) { flash(t('这一版已经在往来稿里了')); return; }
      const v: ThreadVersion = { id: uid(), n: (th.versions[th.versions.length - 1]?.n || 0) + 1, side, added: Date.now(), file, fp: fingerprint(d), orig: f.path };
      const next = { ...th, updated: Date.now(), versions: [...th.versions, v] };
      await commitLib({ ...libRef.current, threads: libRef.current.threads.map((x) => (x.id === th.id ? next : x)) });
      const va = th.versions.find((x) => x.id === against) || th.versions[th.versions.length - 1];
      setThread(null);
      if (!(await loadPair(va, f, true))) return;
      setThread({ id: th.id, a: va.id, b: v.id });
      setCompared(true); setTab(2);
      flash(t('已加为 V{n}', { n: v.n }));
    } catch (e: any) { flash(String(e?.message || e)); }
  };
  const deleteThread = (th: Thread) => softDelete(
    (l) => ({ ...l, threads: l.threads.map((y) => (y.id === th.id ? { ...y, deleted: Date.now() } : y)) }),
    (l) => ({ ...l, threads: l.threads.map((y) => (y.id === th.id ? { ...y, deleted: undefined } : y)) }),
    t('已删除往来稿'), th.name);
  const commitLib = async (next: Library, purge = false) => {
    setLib(next);
    const r = await saveLibrary(next, purge);
    if (!r.ok) flash(t('模板没能保存到本机：{e}', { e: r.error || '' }));
  };
  /** 选一个文件、读出段落指纹、拷进库 */
  const pickForLibrary = async (): Promise<{ file: any; fp: number[]; f: FileInfo } | null> => {
    const f: FileInfo | null = await api.openDialog();
    if (!f) return null;
    setLibBusy(true);
    try {
      const d = await loadDoc(f);
      const file = await putFile(f.path);
      return { file, fp: fingerprint(d), f };
    } catch (e: any) {
      flash(e instanceof NeedPassword ? t('加密的 PDF 不能存成模板') : String(e?.message || e));
      return null;
    } finally { setLibBusy(false); }
  };
  const newTemplate = async () => {
    const x = await pickForLibrary();
    if (!x) return;
    const now = Date.now();
    const tpl: Template = { id: uid(), name: stemOf(x.f.name), created: now, updated: now, versions: [{ id: uid(), label: versionLabel(x.f.mtime, []), added: now, file: x.file, fp: x.fp, orig: x.f.path }] };
    await commitLib({ ...libRef.current, templates: [...libRef.current.templates, tpl] });
    flash(t('已存为模板「{n}」', { n: tpl.name }));
  };
  const addTplVersion = async (tpl: Template) => {
    const x = await pickForLibrary();
    if (!x) return;
    if (tpl.versions.some((v) => v.file.sha === x.file.sha)) { flash(t('这个版本已经在模板里了')); return; }
    const v: TplVersion = { id: uid(), label: versionLabel(x.f.mtime, tpl.versions.map((y) => y.label)), added: Date.now(), file: x.file, fp: x.fp, orig: x.f.path };
    await commitLib({ ...libRef.current, templates: libRef.current.templates.map((y) => (y.id === tpl.id ? { ...y, updated: Date.now(), versions: [...y.versions, v] } : y)) });
    flash(t('已加入新版本 {v}', { v: v.label }));
  };
  const renameTpl = (tpl: Template, name: string) => commitLib({ ...libRef.current, templates: libRef.current.templates.map((y) => (y.id === tpl.id ? { ...y, name, updated: Date.now() } : y)) });
  /** 删除：先做标记，10 秒内可撤销，之后真正清掉（连同库里不再用到的文件） */
  const softDelete = (apply: (l: Library) => Library, restore: (l: Library) => Library, msg: string, obj?: string) => {
    commitLib(apply(libRef.current));
    clearTimeout(undoTimer.current);
    clearTimeout(purgeTimer.current);
    setUndoToast({ msg, obj, undo: () => { clearTimeout(undoTimer.current); setUndoToast(null); commitLib(restore(libRef.current)); flash(t('已撤销删除')); } });
    undoTimer.current = setTimeout(() => setUndoToast(null), UNDO_MS);
    purgeTimer.current = setTimeout(() => {
      const l = libRef.current;
      commitLib({ ...l, templates: l.templates.filter((y) => !y.deleted), threads: l.threads.filter((y) => !y.deleted) }, true);
    }, UNDO_MS);
  };
  const deleteTpl = (tpl: Template) => softDelete(
    (l) => ({ ...l, templates: l.templates.map((y) => (y.id === tpl.id ? { ...y, deleted: Date.now() } : y)) }),
    (l) => ({ ...l, templates: l.templates.map((y) => (y.id === tpl.id ? { ...y, deleted: undefined } : y)) }),
    t('已删除模板'), tpl.name);
  const deleteTplVersion = (tpl: Template, v: TplVersion) => {
    const idx = tpl.versions.findIndex((x) => x.id === v.id);
    softDelete(
      (l) => ({ ...l, templates: l.templates.map((y) => (y.id === tpl.id ? { ...y, versions: y.versions.filter((x) => x.id !== v.id) } : y)) }),
      (l) => ({ ...l, templates: l.templates.map((y) => (y.id === tpl.id ? { ...y, versions: [...y.versions.slice(0, idx), v, ...y.versions.slice(idx)] } : y)) }),
      t('已删除版本 {v}', { v: v.label }));
  };
  // 首页只放了对方文件：看看像哪个模板的哪一版
  const homeMatch = useMemo(() => {
    if (compared || A || !B || B.sha256 === matchOff) return null;
    const fp = fingerprint(B);
    const tm = matchThreads(fp, live(lib.threads).filter((x) => !x.archived));
    const vs = live(lib.templates).flatMap((tp) => tp.versions.map((v) => ({ ...v, tpl: tp })));
    const pb = vs.length ? pick(fp, vs).best : null;
    if (tm && (!pb || tm.score >= pb.score)) return tm as any;
    return pb ? { tpl: pb.item.tpl, v: pb.item as TplVersion, score: pb.score } : null;
  }, [compared, A, B, lib, matchOff]);
  const startFromTemplate = async (v: TplVersion) => {
    setTplDlg(null);
    const tpl = libRef.current.templates.find((x) => x.versions.some((y) => y.id === v.id));
    const f = await readVersion(v);
    if (!f) { flash(t('模板文件不见了')); return; }
    setThread(null);
    await loadFile(0, f);
    setCompared(true); setTab(0);
    if (tpl) setTplThread({ tid: tpl.id, v });
  };
  // 用模板比较的结果自动成为往来稿（等两份文件都读好）
  const [tplThread, setTplThread] = useState<{ tid: string; v: TplVersion } | null>(null);
  useEffect(() => { if (tplThread && compared && A && B && !busy[0] && !busy[1] && A.sha256 === tplThread.v.file.sha) { const x = tplThread; setTplThread(null); saveAsThread(x); } }, [tplThread, compared, A, B, busy]);
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
  const readIssueDocs = ([[0, A], [1, B]] as [number, DocModel | null][]).filter(([, d]) => d?.readIssues) as [number, DocModel][];
  // 有读不出文字的页：图像里这些页也可能缺字，不能当成“相同”
  const suspectPages = useMemo(() => new Set(readIssueDocs.flatMap(([, d]) => d.readIssues!.pages)), [A, B]);
  // 富文本 / 修订审阅：正文 + 页眉 + 页脚 + 脚注
  const RA = useMemo(() => (A ? { ...A, blocks: compareBlocks(A) } : null), [A]);
  const RB = useMemo(() => (B ? { ...B, blocks: compareBlocks(B) } : null), [B]);
  const richTask = useMemo(() => (compared && RA && RB
    ? { key: `rich|${docSig}|${optKey}`, blocksA: RA.blocks, blocksB: RB.blocks, opts: { ...opts, mergeParas: true } }
    : null), [compared, docSig, optKey, RA, RB]);
  const rich = useDiff(richTask, docSig);
  const richRes = rich.res;

  const plainBlocks = useMemo(() => (A && B ? [linesToBlocks(docPlainText(A)), linesToBlocks(docPlainText(B))] : null), [A, B]);
  const plainTask = useMemo(() => (compared && plainBlocks && tab === 1
    ? { key: `plain|${docSig}|${optKey}`, blocksA: plainBlocks[0], blocksB: plainBlocks[1], opts: { ...opts, formatting: false, keepEmpty: true } }
    : null), [compared, plainBlocks, docSig, optKey, tab]);
  const plain = useDiff(plainTask, docSig);
  const plainRes = plain.res;

  // ---------- 页面模式的页数与范围 ----------
  const pairSha = A && B ? `${A.sha256 || A.file.path}|${B.sha256 || B.file.path}` : '';
  const pageTab = tab === 3 || tab === 4;
  useEffect(() => {
    if (!compared || !pageTab || !A || !B || pageCounts?.key === pairSha) return;
    let alive = true;
    Promise.all([getPageCount(A), getPageCount(B)])
      .then(([a, b]) => { if (alive) setPageCounts({ key: pairSha, a, b }); })
      .catch(() => { if (alive) setPageCounts({ key: pairSha, a: 0, b: 0 }); });
    return () => { alive = false; };
  }, [compared, pageTab, pairSha]);
  const counts = pageCounts?.key === pairSha ? pageCounts : null;
  const totalPages = counts ? Math.max(counts.a, counts.b) : 0;
  const chosenRange = pageRanges[pairSha];
  const pageRange: PageRange | null = !counts ? null : chosenRange || (totalPages > BIG_PAGES ? null : fullRange(totalPages));
  const needGate = !!counts && !chosenRange && totalPages > BIG_PAGES;
  const setPageRange = (r: PageRange) => setPageRanges((m) => ({ ...m, [pairSha]: r }));
  const changePageRange = () => setPageRanges((m) => { const n = { ...m }; delete n[pairSha]; return n; });

  const ocrKey = A && B && pageRange ? `${A.sha256}|${B.sha256}|${prefs.ocrLang}|${rangeKey(pageRange)}` : '';
  const ocrBlocks = useMemo(() => (ocr.status === 'done' && ocr.key === ocrKey ? [linesToBlocks(ocr.a!), linesToBlocks(ocr.b!)] : null), [ocr, ocrKey]);
  const ocrTask = useMemo(() => (ocrBlocks && tab === 4
    ? { key: `ocr|${ocrKey}|${optKey}`, blocksA: ocrBlocks[0], blocksB: ocrBlocks[1], opts: { ...opts, formatting: false, keepEmpty: true } }
    : null), [ocrBlocks, ocrKey, optKey, tab]);
  const ocrDiff = useDiff(ocrTask, docSig);
  const ocrRes = ocrDiff.res;
  const diffJob = tab === 1 ? plain : tab === 4 ? ocrDiff : rich;
  const imgState = useImagePages(tab === 3 && compared && A && B ? A : (null as any), tab === 3 && compared && A && B ? B : (null as any), prefs.threshold, tab === 3 ? pageRange : null);
  // 范围那一行：选了哪些页 + 做到哪一步（1.7.4 起分开说）
  const rangeProgress: RangeProgress = tab === 3
    ? { phase: imgState.status, done: imgState.done, n: imgState.n || undefined, onResume: imgState.resume }
    : ocr.status === 'running' ? { phase: 'running', done: ocr.done || 0, n: ocr.n, ocr: true }
    : ocr.status === 'done' ? { phase: 'done', ocr: true }
    : ocr.status === 'error' ? { phase: 'error', done: ocr.done || 0, n: ocr.n, ocr: true }
    : { phase: ocr.stopped ? 'stopped' : 'pending', done: ocr.done || 0, n: ocr.n, ocr: true };
  const rangeHead = pageRange && counts ? <RangeLine range={pageRange} total={totalPages} onChange={totalPages > BIG_PAGES ? changePageRange : undefined} progress={rangeProgress} /> : null;

  // ---------- 解读：条款、风险、比较范围 ----------
  const clauses = useMemo(() => (richRes && RA && RB ? clauseMap(richRes, RA.blocks, RB.blocks) : new Map<number, string | null>()), [richRes, RA, RB]);
  const risks: Risk[] = useMemo(() => (richRes ? detectRisks(richRes, clauses, { money: prefs.riskMoney, date: prefs.riskDate, keywords: prefs.keywords }) : []), [richRes, clauses, prefs.riskMoney, prefs.riskDate, prefs.keywords]);
  const riskById = useMemo(() => new Map(risks.map((r) => [r.cid, r])), [risks]);
  const scope = useMemo(() => (A && B ? scopeInfo(A, B, opts, richRes) : null), [A, B, optKey, richRes, lang]);
  const noClauses = useMemo(() => new Map<number, string | null>(), []);

  // ---------- 审阅决定：载入 / 保存 / 设置变化后的迁移 ----------
  const reviewer = prefs.reviewerName.trim() || t('审阅人');
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
  useEffect(() => { if (richRes && decFor.current === richRes) { saveDecisions(pk, richRes.changes, decisions); draftSync?.update(decisions); } }, [decisions]);

  // ---------- 审阅稿（1.8）：修改后文档是 Word 时，决定自动写进它旁边的一份拷贝 ----------
  const [draftSync, setDraftSync] = useState<DraftSync | null>(null);
  const [draftState, setDraftState] = useState<DraftState>({ s: 'none', unwritten: [], prior: 0 });
  // 只在真的写好后提示（beta.7 · E5）；没写完的情况由状态片和完成页说明
  useEffect(() => { if (draftState.regenerated && draftState.s === 'saved' && !draftState.unwritten.length) flash(t('原来的审阅稿不见了，已按 DocDiff 里的决定在原位置重建。在 Word 里直接改的内容没有保留。')); }, [draftState.regenerated, draftState.s]);
  const heldN = richRes ? richRes.changes.filter((c) => decisions[c.id]?.v === 'h').length : 0;
  const allDecided = !!richRes && richRes.changes.length > 0 && richRes.changes.every((c) => decisions[c.id]?.v);
  // 原始文档是谁：往来稿里写版本号（第一版来自模板时写模板名和版本），普通比较写文件名
  const origLabel = (() => {
    if (activeTh && thread) {
      const va = activeTh.versions.find((v) => v.id === thread.a);
      if (!va) return '';
      const tp = va === activeTh.versions[0] && activeTh.tpl ? lib.templates.find((x) => x.id === activeTh.tpl!.tid) : null;
      const tv = tp?.versions.find((v) => v.id === activeTh.tpl!.vid);
      return tp && tv ? t('模板「{n}」{v}', { n: tp.name, v: tv.label }) : `V${va.n}`;
    }
    return A ? A.file.name : '';
  })();
  // 只有真的写好（没被 Word 占着、没有写不进的处）才算“可以发给对方”（P1-1）
  const draftReady = draftState.s === 'saved' && !draftState.unwritten.length && !!draftState.path;
  const [finalReq, setFinalReq] = useState(0);
  /** 刚生成的定稿（完成页显示）；换了文件或决定变了就清掉 */
  const [finalMade, setFinalMade] = useState('');
  useEffect(() => { setFinalMade(''); }, [pk]);
  const baseOfPath = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);
  // 审阅稿只属于修订审阅（beta.6）：进入修订审阅后才开始检查、生成和同步；之后切到别的模式也不打断正在进行的写入，但不显示
  const [draftArmed, setDraftArmed] = useState('');
  useEffect(() => { if (tab === 2 && pk && draftArmed !== pk) setDraftArmed(pk); }, [tab, pk]);
  useEffect(() => {
    if (!richRes || !RA || !RB || !B || B.type !== 'docx' || !B.file.path || !pk || draftArmed !== pk) { setDraftSync(null); setDraftState({ s: 'none', unwritten: [], prior: 0 }); return; }
    const plan = buildPlan(richRes, RA.blocks, RB.blocks);
    const sync = new DraftSync({
      pk, bPath: B.file.path, bName: B.file.name, noDir: !!(B.file as any).lib, bData: B.file.data, plan,
      reviewer, initials: prefs.reviewerInitials.trim() || initialsOf(reviewer),
      theirs: prefs.authorName.trim() || B.meta['最后修改者'] || B.meta['作者'] || t('修改方'),
      theirsDate: B.file.mtime || Date.now(), pattern: prefs.draftName.trim() || t('{name}-我方意见'),
      onMissing: prefs.draftMissing,
    });
    const off = sync.subscribe(setDraftState);
    setDraftSync(sync);
    if (decFor.current === richRes) sync.update(decisions);
    return () => { off(); sync.dispose(); };
  }, [richRes, pk, draftArmed]);
  const draftVer = activeTh && thread ? activeTh.versions.find((v) => v.id === thread.b) : null;
  useEffect(() => { if (draftSync) { draftSync.ctx.ver = draftVer ? `V${draftVer.n}` : undefined; const renamed = draftSync.ctx.reviewer !== reviewer || draftSync.ctx.initials !== (prefs.reviewerInitials.trim() || initialsOf(reviewer)); draftSync.ctx.initials = prefs.reviewerInitials.trim() || initialsOf(reviewer); if (renamed) { draftSync.ctx.reviewer = reviewer; draftSync.touch(); } draftSync.ctx.reviewer = reviewer; draftSync.ctx.onMissing = prefs.draftMissing; draftSync.ctx.pattern = prefs.draftName.trim() || t('{name}-我方意见'); draftSync.ctx.theirs = prefs.authorName.trim() || B?.meta['最后修改者'] || B?.meta['作者'] || t('修改方'); } }, [draftSync, reviewer, prefs.reviewerInitials, prefs.draftName, prefs.authorName, prefs.draftMissing, draftVer]);
  // 往来稿：这一轮的结论摘要存进往来稿（只存有结论或备注的处），供下一轮的“上轮”提示和条款历史使用
  const roundTimer = useRef<any>(0);
  useEffect(() => {
    if (!thread || !richRes || decFor.current !== richRes) return;
    clearTimeout(roundTimer.current);
    roundTimer.current = setTimeout(() => {
      const items = richRes.changes.filter((c) => decisions[c.id]?.v || decisions[c.id]?.note)
        .map((c) => ({ clause: clauses.get(c.id) ?? null, before: c.before.slice(0, 300), after: c.after.slice(0, 300), v: decisions[c.id]?.v, note: decisions[c.id]?.note }));
      const r: Round = { a: thread.a, b: thread.b, pk, total: richRes.changes.length, decided: richRes.changes.filter((c) => decisions[c.id]?.v).length, updated: Date.now(), items };
      const th = libRef.current.threads.find((x) => x.id === thread.id);
      if (!th) return;
      const old = th.rounds.find((x) => x.a === r.a && x.b === r.b);
      if (old && old.decided === r.decided && JSON.stringify(old.items) === JSON.stringify(r.items)) return;
      updThread(th.id, (x) => ({ ...x, updated: Date.now(), rounds: [...x.rounds.filter((y) => !(y.a === r.a && y.b === r.b)), r] }));
    }, 600);
  }, [decisions, thread, richRes]);
  // 打开往来稿时把各轮的结论摘要读进来（首页只读索引，不带这些）
  useEffect(() => {
    if (!thread) return;
    const id = thread.id;
    loadRounds(id).then((rs) => {
      if (!rs.length) return;
      setLib((l) => ({ ...l, threads: l.threads.map((x) => (x.id !== id ? x : { ...x, rounds: x.rounds.map((r) => (r.items ? r : { ...r, items: rs.find((y) => y.a === r.a && y.b === r.b)?.items || [] })) })) }));
    });
  }, [thread?.id]);
  const hints = useMemo(() => (activeTh && thread && richRes ? hintsFor(richRes.changes, clauses, activeTh, thread.b) : new Map()), [activeTh, thread, richRes, clauses]);
  // 绑定的往来稿和当前文件对不上了（换了文件）：退出往来稿模式
  useEffect(() => {
    if (!thread || busy[0] || busy[1] || !A || !B) return;
    const th = libRef.current.threads.find((x) => x.id === thread.id);
    const va = th?.versions.find((v) => v.id === thread.a), vb = th?.versions.find((v) => v.id === thread.b);
    if (!th || va?.file.sha !== A.sha256 || vb?.file.sha !== B.sha256) setThread(null);
  }, [A?.sha256, B?.sha256]);
  useEffect(() => {
    // 只在修订审阅里检查和补写审阅稿（beta.7 · P2-3）；切回修订审阅时由 tab 的 effect 再检查一次
    const onFocus = () => { if (actions.current.tab === 2) draftSync?.check(); };
    if (draftSync) { const was = draftSync.paused; draftSync.paused = tab !== 2; if (was && tab === 2) draftSync.check(); }
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [draftSync, tab]);

  useEffect(() => setDismissDegraded(false), [docSig, optKey]);
  useEffect(() => setSelCid(null), [tab, richRes, plainRes, ocrRes]);
  useEffect(() => setFilter('all'), [docSig]);
  useEffect(() => { setPop(null); if (filter === 'risk' && tab !== 0 && tab !== 2) setFilter('all'); }, [tab]);

  const curRes: DiffResult | null = tab === 0 || tab === 2 ? richRes : tab === 1 ? plainRes : tab === 4 ? ocrRes : null;
  const changes: Change[] = curRes?.changes || [];
  const shown: Change[] = useMemo(() => (filter === 'all' ? changes : filter === 'risk' ? changes.filter((c) => riskById.has(c.id)) : changes.filter((c) => c.kind === filter)), [changes, filter, riskById]);
  // 悬停清单里的一行：纸上对应的字和地图刻度描边（不跳转）
  const hoverCid = useCallback((id: number | null) => {
    document.querySelectorAll('.hov').forEach((el) => el.classList.remove('hov'));
    if (id == null) return;
    document.querySelectorAll(`.main [data-cid="${id}"], .cm-tick[data-tick="${id}"]`).forEach((el) => el.classList.add('hov'));
  }, []);
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

  /** 批量决定的影响：总数、会被改掉的已有结论数、会被清空的结论数 */
  const bulkImpact = (kind: 'a' | 'r' | 'reset') => {
    const withV = changes.filter((c) => decisions[c.id]?.v);
    if (kind === 'reset') return { total: changes.length, overwrite: 0, clear: withV.length, same: 0 };
    const overwrite = withV.filter((c) => decisions[c.id]!.v !== kind).length;
    const same = withV.length - overwrite;
    return { total: changes.length, overwrite, clear: 0, same };
  };
  // 沿用上轮结论（往来稿）：只针对“对方又改回来”和“一模一样的修改”，只改还没决定的处
  const [reuseAsk, setReuseAsk] = useState(false);
  const reusable = useMemo(() => (tab === 2 ? changes.filter((c) => !decisions[c.id]?.v && hints.get(c.id)?.reuse).map((c) => ({ c, h: hints.get(c.id)! })) : []), [tab, changes, decisions, hints]);
  const applyReuse = () => {
    const snap = { decisions, order: decideOrder.current.slice(), sel: selCid };
    const next = { ...decisions };
    for (const { c, h } of reusable) next[c.id] = { ...mkDec(h.reuse, decisions[c.id]), note: decisions[c.id]?.note };
    setDecisions(next);
    setReuseAsk(false);
    clearTimeout(undoTimer.current);
    setUndoToast({ msg: t('已沿用上轮结论（{n} 处）', { n: reusable.length }), undo: () => { clearTimeout(undoTimer.current); decideOrder.current = snap.order; setDecisions(snap.decisions); setSelCid(snap.sel); setUndoToast(null); flash(t('已撤销，结论恢复到操作前')); } });
    undoTimer.current = setTimeout(() => setUndoToast(null), 10000);
  };
  const runBulk = (kind: 'a' | 'r' | 'reset') => {
    const snap = { decisions, order: decideOrder.current.slice(), sel: selCid };
    const imp = bulkImpact(kind);
    decideAll(kind === 'reset' ? null : kind);
    setBulkAsk(null);
    clearTimeout(undoTimer.current);
    const msg = kind === 'reset' ? t('已清空 {n} 个结论', { n: imp.clear })
      : t(kind === 'a' ? '已全部接受（{n} 处）' : '已全部拒绝（{n} 处）', { n: imp.total });
    setUndoToast({
      msg,
      undo: () => {
        clearTimeout(undoTimer.current);
        decideOrder.current = snap.order;
        setDecisions(snap.decisions);
        setSelCid(snap.sel);
        setDoneOpen(false);
        setUndoToast(null);
        flash(t('已撤销，结论恢复到操作前'));
      },
    });
    undoTimer.current = setTimeout(() => setUndoToast(null), 10000);
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
  const runOcr = async (r?: PageRange) => {
    const range = r || pageRange;
    if (!A || !B || !range) return;
    const key = `${A.sha256}|${B.sha256}|${prefs.ocrLang}|${rangeKey(range)}`;
    const run = ++ocrRun.current;
    const alive = () => { if (ocrRun.current !== run) throw new Cancelled(); };
    const langs = prefs.ocrLang.split('+');
    setOcr({ status: 'running', msg: t('正在准备页面…'), pct: 0, key });
    let off: (() => void) | null = null;
    try {
      const texts: string[] = [];
      const confs: number[][] = [], lows: Map<number, Set<number>>[] = [];
      // 逐页渲染、每 6 页送去识别一次：内存里只放这一小批图片（1.7.2 以前一次渲染全部页，只好截到 300 页）
      const BATCH = 6;
      for (const [si, d] of [[0, A], [1, B]] as [number, DocModel][]) {
        const total = Math.max(0, Math.min(range.to, await getPageCount(d)) - range.from + 1);
        alive();
        const pagesOut: { page: number; text: string; conf: number; words: [string, number][] }[] = [];
        let base = 0;
        off?.();
        off = api.onOcrProgress(({ page, progress, run: rr }: any) => {
          if (rr !== undefined && rr !== run) return;
          const done = base + page + progress;
          const pct = ((si * total + done) / (2 * Math.max(1, total))) * 100;
          api.setProgress?.(pct / 100);
          setOcr((o) => (o.status === 'running' && ocrRun.current === run ? { ...o, pct, done: si * total + base + page, n: 2 * total, msg: t('正在识别{s}：第 {i}/{n} 页', { s: sideLabel(si as Side), i: Math.min(total, base + page + 1), n: total }) } : o));
        });
        let batch: { page: number; img: Uint8Array }[] = [];
        const flush = async () => {
          if (!batch.length) return;
          const res: any[] = await api.ocr({ images: batch.map((x) => x.img), langs, run });
          alive();
          res.forEach((x, k) => pagesOut.push({ page: batch[k].page, ...(typeof x === 'string' ? { text: x, conf: -1, words: [] } : x) }));
          base += batch.length;
          batch = [];
        };
        await forEachPage(d, 2, range, async (p, i) => {
          alive();
          const blob: Blob = await new Promise((rs) => p.canvas.toBlob((bb) => rs(bb!), 'image/png'));
          batch.push({ page: i, img: new Uint8Array(await blob.arrayBuffer()) });
          if (batch.length >= BATCH) await flush();
        }, () => ocrRun.current === run);
        alive();
        await flush();
        const full = pagesOut.map((x) => (total > 1 || range.from > 1 ? `—— ${t('第 {n} 页', { n: x.page })} ——\n` : '') + cleanOcr(x.text)).join('\n\n');
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
      setOcr((o) => (/取消/.test(m) ? { status: 'idle', stopped: true, done: o.done, n: o.n } : { status: 'error', msg: m, key, done: o.done, n: o.n }));
    } finally { off?.(); if (ocrRun.current === run) api.setProgress?.(-1); }
  };
  const cancelOcr = () => { const run = ocrRun.current; ocrRun.current++; api.ocrCancel?.(run); api.setProgress?.(-1); setOcr((o) => ({ status: 'idle', stopped: true, done: o.done, n: o.n })); flash(t('已取消识别')); };
  const lowWords = ocr.low;

  // ---------- 菜单 & 键盘 ----------
  const canCompare = !!(A && B) && !busy[0] && !busy[1];
  const startCompare = () => { if (canCompare) { setCompared(true); setTab(0); setChangedSides([]); } };
  const clearAll = () => { clearPageCaches(); setThread(null); setDocs([null, null]); setCompared(false); setErrs([null, null]); ocrRun.current++; setOcr({ status: 'idle' }); setChangedSides([]); setLostBanner(null); lastLoaded.current = null; };
  const swap = () => { setThread(null); setDocs(([a, b]) => [b, a]); ocrRun.current++; setOcr({ status: 'idle' }); };
  const actions = useRef<any>({});
  actions.current = { open, swap, clearAll, go, decide, setTab, startCompare, toggleNav, toggleAside, compared, tab, selCid, undoBulk: undoToast?.undo, modal: !!(pwd || pasteSide !== null || showSettings || exportOpen || pop || bulkAsk) };
  useEffect(() => api.onMenu((cmd: string, arg?: any) => {
    const a = actions.current;
    // 弹窗、弹出层开着时，菜单栏和它的快捷键（⌘1 / ⌘3 / ⌘N 等）同样不作用到后台（beta.7 · P1-2，和键盘处理一致）
    if (cmd !== 'fullscreen' && (a.modal || document.querySelector('.modal-bg') || document.querySelector('.pop:not(.draft-tip)'))) return;
    if (cmd === 'open-left') a.open(0);
    else if (cmd === 'open-right') a.open(1);
    else if (cmd === 'swap') a.swap();
    else if (cmd === 'clear') a.clearAll();
    else if (cmd === 'tab' && a.compared) a.setTab(arg);
    else if (cmd === 'next') a.go(1);
    else if (cmd === 'prev') a.go(-1);
    else if (cmd === 'fullscreen') document.documentElement.dataset.fullscreen = arg ? '1' : '';
    else if (cmd === 'toggle-nav' && a.compared) a.toggleNav();
    else if (cmd === 'toggle-aside' && a.compared) a.toggleAside();
  }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || a.modal || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || modPressed(e) || e.altKey) return;
      // 任何弹窗开着、或焦点在弹出层里时，A/R/H/J/K/U 等都不作用到后台（beta.5：统一按界面判断，新加的弹窗不会漏掉）。
      // 审阅稿首次提示只是说明，不拦快捷键。
      if (document.querySelector('.modal-bg')) return;
      const inPop = t.closest?.('.pop');
      if (inPop && !inPop.classList.contains('draft-tip')) return;
      // 撤销提示在的时候，U 在哪个页面都能撤销（首页删除往来稿 / 模板后也一样）
      if (e.key.toLowerCase() === 'u' && a.undoBulk && (!a.compared || a.tab !== 2)) { e.preventDefault(); a.undoBulk(); return; }
      if (!a.compared) { if (e.key === 'Enter' && t.tagName !== 'BUTTON') a.startCompare(); return; }
      const k = e.key.toLowerCase();
      if (k === 'j') { a.go(1); e.preventDefault(); }
      else if (k === 'k') { a.go(-1); e.preventDefault(); }
      else if (a.tab === 2) {
        if (k === 'a' || k === 'y') a.decide(a.selCid, 'a');
        else if (k === 'r') a.decide(a.selCid, 'r');
        else if (k === 'h') a.decide(a.selCid, 'h');
        else if (k === 'u') { if (a.undoBulk) a.undoBulk(); else a.decide(a.selCid, null); }
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
    draftName: prefs.draftName, finalName: prefs.finalName, draftMissing: prefs.draftMissing,
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
      {showSettings && <SettingsModal v={settingsValues} set={setSetting} onClose={() => setShowSettings(false)} initialTab={showSettings} sample={B?.type === 'docx' ? B.file.name : undefined}
        upd={{ info: upd, checking: checkingUpd, onCheck: () => checkUpdate(true), onSkip: (v) => { set('skipVersion')(v); flash(t('已跳过 {v}，下次有更新的版本再提醒你', { v })); } }} />}
      {exportOpen && richRes && (
        <ExportDialog total={richRes.changes.length} undecided={richRes.changes.length - richRes.changes.filter((c) => decisions[c.id]?.v).length} risks={risks.length}
          author={expAuthor} setAuthor={setExpAuthor}
          reviewer={prefs.reviewerName} setReviewer={(v) => { setPrefs((p) => ({ ...p, reviewerName: v, reviewerInitials: initialsOf(v), reviewerAsked: true })); }}
          commentAccepted={prefs.commentAccepted} setCommentAccepted={set('commentAccepted')}
          hasSections={richRes.rows.some((r) => r.sec && r.sec !== 'body')}
          onExport={doExport} onHoldPending={() => decideAll('h', true)} onClose={() => setExportOpen(false)} busy={exportBusy}
          draft={draftReady ? { name: baseOfPath(draftState.path!), open: () => api.openExternalFile?.(draftState.path) } : null} />
      )}
      {/* 有撤销提示时，新的提示叠在它上面，不再被吞掉（beta.7：如“审阅稿已重建”） */}
      {toast && <div className={`toast${undoToast ? ' above' : ''}`} role="status" aria-live="polite">{toast}</div>}
      {undoToast && (
        <div className="toast undo" role="status" aria-live="polite">
          <span className="tm">{undoToast.msg}</span>
          {undoToast.obj && <span className="to" title={undoToast.obj}>「<MidName name={undoToast.obj} title={false} />」</span>}
          <button type="button" className="toast-btn" onClick={undoToast.undo}>{t('撤销')} <Kbd>U</Kbd></button>
          <button type="button" className="toast-x" aria-label={t('关闭')} onClick={() => { clearTimeout(undoTimer.current); setUndoToast(null); }}><I.IconX /></button>
        </div>
      )}
      {bulkAsk && (() => {
        const imp = bulkImpact(bulkAsk);
        const title = bulkAsk === 'a' ? t('全部接受 {n} 处修订？', { n: imp.total }) : bulkAsk === 'r' ? t('全部拒绝 {n} 处修订？', { n: imp.total }) : t('清空所有审阅结论？');
        const lines = bulkAsk === 'reset'
          ? [t('{n} 个结论会被清空，回到“未决定”。', { n: imp.clear }), t('备注会保留。')]
          : [
              imp.overwrite ? t('其中 {n} 处已有其他结论，会被覆盖。', { n: imp.overwrite }) : null,
              imp.same ? t('{n} 处本来就是这个结论，不变。', { n: imp.same }) : null,
              imp.total - imp.overwrite - imp.same ? t('{n} 处还没决定，会一起设好。', { n: imp.total - imp.overwrite - imp.same }) : null,
              t('结论署名为 {r}，时间为现在。', { r: reviewer }),
            ].filter(Boolean) as string[];
        return (
          <Modal title={title} onClose={() => setBulkAsk(null)} className="bulk-ask"
            footer={<><button className="btn plain" onClick={() => setBulkAsk(null)}>{t('取消')}</button>
              <button className={`btn ${bulkAsk === 'a' ? 'primary' : bulkAsk === 'r' ? 'red' : 'danger'}`} autoFocus onClick={() => runBulk(bulkAsk)}>
                {bulkAsk === 'a' ? t('全部接受') : bulkAsk === 'r' ? t('全部拒绝') : t('清空结论')}</button></>}>
            <ul className="bulk-lines">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
            <p className="bulk-note">{t('做完 10 秒内可以撤销，回到操作前的全部结论。')}</p>
          </Modal>
        );
      })()}
    </>
  );

  // =================== 首页 ===================
  // 工具栏放不下时依次收起：0 全部带文字 → 1 复制摘要只留图标 → 2 导出也只留图标、文件片去掉“原始/修改后” → 3 审阅稿只留圆点 → 4 文件片也变窄。
  // 直接改 header 的 data-level 再量，不走 React 状态（beta.4：避免为了收按钮把整个界面重新渲染好几遍）。
  // 只在工具栏内容变了、或窗口宽度变了时量。
  const tbRef = useRef<HTMLElement | null>(null);
  const fitToolbar = useCallback(() => {
    const el = tbRef.current;
    if (!el) return;
    for (let l = 0; l <= 4; l++) {
      el.dataset.level = String(l);
      if (el.scrollWidth <= el.clientWidth + 1) break;
    }
  }, []);
  // 完成页的交接区（beta.7 · D1 / D3 / E3）：只有审阅稿真的写好了，才说“要发给对方的就是这份”
  const finalBtn = (hasDraft: boolean) => heldN > 0
    ? <button className="btn plain block" onClick={() => { setDoneOpen(false); setFinalReq((n) => n + 1); }}>{t('谈完后：生成定稿…')}</button>
    : hasDraft ? null : <button className="btn big block" onClick={() => { setDoneOpen(false); setFinalReq((n) => n + 1); }}>{t('生成定稿…')}</button>;
  const fileRow = (p?: string) => p ? <div className="file-row"><TypeTag type="docx" /><MidName name={baseOfPath(p)} /></div> : null;
  const doneTail = (
    <>
      {finalMade && (
        // 定稿已生成（1.8 · R3）：标题一行，文件单独一行（中间省略），按钮放在下面，长文件名不撑出卡片
        <div className="done-final" role="status">
          <div className="df-h"><I.IconOk />{t('定稿已生成')}</div>
          {fileRow(finalMade)}
          <div className="df-acts"><button type="button" className="btn sm" onClick={() => api.openExternalFile?.(finalMade)}>{t('打开')}</button><button type="button" className="btn sm" onClick={() => api.reveal?.(finalMade)}>{t('在文件夹中显示')}</button></div>
        </div>
      )}
      <button className="btn plain block" onClick={() => { setDoneOpen(false); openExport(); }}>{t('导出报告或其他格式…')}</button>
      <button className="btn plain block" onClick={() => setDoneOpen(false)}>{t('回去再看看')}</button>
    </>
  );
  const ds = draftState, unN = (ds.unwritten || []).length;
  const unList = (ds.unwritten || []).slice(0, 3).map((u) => t('第 {i} 处（{r}）', { i: u.cid, r: t(REASON[u.reason]) })).join(t('、')) + (unN > 3 ? t(' 等 {n} 处', { n: unN }) : '');
  const doneActs = !draftSync ? (
    <div className="done-acts">
      <button className="btn primary big block" onClick={() => { setDoneOpen(false); openExport(); }}><I.IconExport />{t('导出审阅结果…')}</button>
      <button className="btn plain block" onClick={() => setDoneOpen(false)}>{t('回去再看看')}</button>
    </div>
  ) : ds.s === 'none' ? (
    // E3：还没开始审阅稿——结论只记在 DocDiff 里，主按钮是“生成审阅稿”，点了原地变成 D1
    <div className="done-acts">
      <Notice tone="info" title={t('结论目前只记在 DocDiff 里')}>{t('要发给对方时，生成一份审阅稿：在对方文件旁边写好你的修订和批注，格式不变。')}</Notice>
      <button className="btn primary big block" onClick={() => draftSync.start(t('选择放审阅稿的文件夹'))}>{t('生成审阅稿')}</button>
      {finalBtn(false)}
      {doneTail}
    </div>
  ) : (ds.s === 'saved' && !unN) || ds.s === 'saving' ? (
    // D1 ①：已写好（写入中时按钮暂不可用）
    <div className="done-acts">
      <p className="done-draft">{heldN > 0 ? t('要发给对方的就是这份审阅稿，{n} 处待议已写成批注：', { n: heldN }) : t('所有决定已写进审阅稿，要发给对方的就是这份：')}</p>
      {fileRow(ds.path)}
      <button className="btn primary big block" disabled={ds.s === 'saving'} onClick={() => { api.openExternalFile?.(ds.path); }}>{ds.s === 'saving' ? t('正在写入…') : t('打开审阅稿')}</button>
      {heldN > 0 ? (
        <><button className="btn big block" disabled={!ds.path} onClick={() => { api.reveal?.(ds.path); }}>{t('在文件夹中显示')}</button>{finalBtn(true)}</>
      ) : (
        <div className="done-row">
          <button className="btn big block" disabled={!ds.path} onClick={() => { api.reveal?.(ds.path); }}>{t('在文件夹中显示')}</button>
          <button className="btn big block" onClick={() => { setDoneOpen(false); setFinalReq((n) => n + 1); }}>{t('生成定稿…')}</button>
        </div>
      )}
      {doneTail}
    </div>
  ) : ds.s === 'locked' ? (
    // D3 ②：Word 占着，最新的决定没写进去；切回 DocDiff 时自动再试，写完自动变成 ①
    <div className="done-acts">
      <Notice tone="warn" title={t('在 Word 里关掉它，DocDiff 会自动写完')}>{t('写完之前先别发给对方。回到 DocDiff 时会自动再试一次。')}</Notice>
      <p className="done-draft">{t('这份审阅稿还没写进最新的决定：')}</p>
      {fileRow(ds.path)}
      <button className="btn primary big block" onClick={() => draftSync.retry()}>{t('重新写入')}</button>
      <button className="btn big block" onClick={() => { api.reveal?.(ds.path); }}>{t('在文件夹中显示')}</button>
      {doneTail}
    </div>
  ) : ds.s === 'saved' ? (
    // D3 ③：有几处写不进去（结构原因，重写也写不进）——列出来，可以直接跳回去；审阅稿里这些处仍是对方的写法
    <div className="done-acts">
      <Notice tone="err" title={t('有 {n} 处没能写进审阅稿', { n: unN })}>{t('{list}。审阅稿里这几处仍是对方的写法，可以回去查看，或在 Word 里手动改。', { list: unList })}</Notice>
      <p className="done-draft">{t('其余决定已写进这份审阅稿：')}</p>
      {fileRow(ds.path)}
      <button className="btn primary big block" onClick={() => { setDoneOpen(false); setFilter('all'); setSelCid(ds.unwritten[0].cid); }}>{unN > 1 ? t('回到没写进去的那 {n} 处', { n: unN }) : t('回到没写进去的那 1 处')}</button>
      <button className="btn big block" onClick={() => { api.openExternalFile?.(ds.path); }}>{t('用 Word 打开审阅稿')}</button>
      {doneTail}
    </div>
  ) : (
    // 被改过 / 不见了 / 写不进 / 出错：交给工具栏的状态片处理
    <div className="done-acts">
      <Notice tone="err" title={ds.s === 'modified' ? t('审阅稿在 DocDiff 之外被改过') : ds.s === 'gone' ? t('审阅稿被移走或删除了') : ds.s === 'nowrite' ? t('审阅稿写不进这个文件夹') : t('没能保存审阅稿')}>
        {t('你的决定都还在。点工具栏的“审阅稿”处理好之后再发给对方。')}
      </Notice>
      <button className="btn primary big block" onClick={() => setDoneOpen(false)}>{t('回去处理')}</button>
      {finalBtn(false)}
      <button className="btn plain block" onClick={() => { setDoneOpen(false); openExport(); }}>{t('导出报告或其他格式…')}</button>
    </div>
  );
  const tbSig = `${tab}|${activeTh?.id || ''}|${draftState.s}|${draftSync ? 1 : 0}|${(draftState.unwritten || []).length}|${!!curRes}|${A?.file.name || ''}|${B?.file.name || ''}|${activeTh?.name || ''}|${thread?.a || ''}|${thread?.b || ''}|${String(changes.length).length}`;
  // 内容变了：等这一帧画完、排版干净时再量（在提交阶段量会强制把整份文档提前排版一遍，打开大文档时多花约 0.1 秒）
  useEffect(() => { const id = requestAnimationFrame(fitToolbar); return () => cancelAnimationFrame(id); }, [tbSig, fitToolbar]);
  useEffect(() => {
    const el = tbRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w0 = el.clientWidth;
    const ro = new ResizeObserver(() => { const w = el.clientWidth; if (w !== w0) { w0 = w; fitToolbar(); } });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!!(compared && A && B), fitToolbar]);
  if (!compared || !A || !B) {
    const openRecent = async (r: any) => {
      // 这一对已经在某份往来稿里：按往来稿打开（有版本片、上轮提示），不当成普通比较
      if (r.a.sha && r.b.sha) {
        for (const th of live(libRef.current.threads)) {
          const i = th.versions.findIndex((v, k) => k > 0 && v.file.sha === r.b.sha && th.versions[k - 1].file.sha === r.a.sha);
          if (i > 0) { await openThread(th, th.versions[i - 1], th.versions[i]); return; }
        }
      }
      const ok = await Promise.all([api.exists(r.a.path), api.exists(r.b.path)]);
      if (!ok[0] || !ok[1]) { flash(t('找不到「{f}」，它可能被移动或删除了', { f: !ok[0] ? r.a.name : r.b.name })); return; }
      await Promise.all([loadFile(0, await api.readPath(r.a.path)), loadFile(1, await api.readPath(r.b.path))]);
      setCompared(true); setTab(0);
    };
    const missing = 2 - (A ? 1 : 0) - (B ? 1 : 0);
    // 老用户 / 新用户（beta.7 · 首页排布）：库里有往来稿、模板或最近比较，就用紧凑布局
    // 最近比较里属于往来稿的一对：写往来稿名和版本号（1.8 · R1）
    const recentThread = (r: any) => {
      if (!r.a.sha || !r.b.sha) return null;
      for (const th of live(lib.threads)) {
        const va = th.versions.find((v) => v.file.sha === r.a.sha), vb = th.versions.find((v) => v.file.sha === r.b.sha);
        if (va && vb) return { name: th.name, a: `V${va.n}`, b: `V${vb.n}` };
      }
      return null;
    };
    const veteran = live(lib.threads).length > 0 || live(lib.templates).length > 0 || recent.length > 0;
    const tplOpen = tplDlg ? lib.templates.find((y) => y.id === tplDlg && !y.deleted) : null;
    return (
      <div className="app home">
        <div className="home-top drag">
          <Wordmark size={36} sub={t('离线文档比对')} />
          <div className="spacer" />
          <button className={`btn plain icon${updBadge ? ' has-dot' : ''}`} title={t(updBadge ? '设置（有新版本）' : '设置')} aria-label={t('设置')} onClick={() => setShowSettings('general')}><I.IconGear /></button>
        </div>
        <div className="home-scroll">
          <div className="home-inner">
            {veteran ? (
              // H：老用户（已有往来稿 / 模板 / 最近比较）——去掉大标题和引导，放置区变矮，库占主要位置
              <div className="home-sh"><h2>{t('新比较')}</h2><span className="grow" />{!A && !B && <button className="btn sm" onClick={trySample}>{t('用示例合同试一下')}</button>}</div>
            ) : (
              // H2：第一次用——保留标题、副标题、吉祥物；去掉五个模式图标和气泡
              <div className="hero">
                <Mascot mood={A && B ? 'cheer' : 'happy'} size={104} className="mascot-bob" />
                <div className="hero-text">
                  <h1>{t(A && B ? '准备好了，开始比较吧' : '找出两份文档的每一处不同')}</h1>
                  <p>{t('Word、PDF、TXT 任意组合，全部在这台电脑上完成，不会上传。')}</p>
                </div>
                {!A && !B && <button className="btn sample-btn" onClick={trySample}>{t('用示例合同试一下')}</button>}
              </div>
            )}
            <div className={`drops${veteran ? ' compact' : ''}`}>
              <DropZone side={0} compact={veteran} doc={A} loading={busy[0]} error={errs[0]} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} onClear={() => setDocs((d) => [null, d[1]])} onPaste={() => setPasteSide(0)} />
              <div className="vs"><button className={veteran ? 'btn plain icon vs-ic' : 'vs-chip'} title={t('交换左右')} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button></div>
              <DropZone side={1} compact={veteran} doc={B} loading={busy[1]} error={errs[1]} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} onClear={() => setDocs((d) => [d[0], null])} onPaste={() => setPasteSide(1)} />
            </div>
            {homeMatch?.th && homeMatch.alt && B && (
              <Notice tone="warn" className="lib-match" title={t('这份文件和两份往来稿都很像')}
                action={<>{[homeMatch, homeMatch.alt].map((m: any) => <button key={m.th.id} type="button" className="btn sm" onClick={() => addThreadVersion(m.th, B.file, 'theirs', m.th.versions[m.th.versions.length - 1].id, B)}>{t('加到「{n}」', { n: m.th.name.length > 14 ? m.th.name.slice(0, 13) + '…' : m.th.name })}</button>)}</>}
                onClose={() => setMatchOff(B?.sha256 || '')} closeLabel={t('不用')}>
                {t('相同段落分别是 {a} 和 {b}，差得太少，不替你选。请确认是哪一份的新版本。', { a: `${Math.round(homeMatch.score * 100)}%`, b: `${Math.round(homeMatch.alt.score * 100)}%` })}
              </Notice>
            )}
            {homeMatch?.th && !homeMatch.alt && B && (
              <MatchNotice title={t('这份文件很像往来稿「{n}」的新一版', { n: homeMatch.th.name })}
                body={t('和 V{k} 相同段落 {p}。加为 V{m} 后默认和上一版 V{l} 比较，上一轮的结论会作为参考显示。', { k: homeMatch.tv.n, p: `${Math.round(homeMatch.score * 100)}%`, m: homeMatch.th.versions[homeMatch.th.versions.length - 1].n + 1, l: homeMatch.th.versions[homeMatch.th.versions.length - 1].n })}
                action={t('加为 V{n}', { n: homeMatch.th.versions[homeMatch.th.versions.length - 1].n + 1 })}
                onUse={() => addThreadVersion(homeMatch.th, B.file, 'theirs', homeMatch.th.versions[homeMatch.th.versions.length - 1].id, B)} onDismiss={() => setMatchOff(B?.sha256 || '')} />
            )}
            {homeMatch?.tpl && (
              <MatchNotice title={t('这份文件很像模板「{n}」的 {v}', { n: homeMatch.tpl.name, v: homeMatch.v.label })}
                body={t('相同段落 {p}。用模板比较时，原始文档会自动用对方拿到的那一版。', { p: `${Math.round(homeMatch.score * 100)}%` })}
                action={t('用模板比较')} onUse={() => setTplDlg(homeMatch.tpl.id)} onDismiss={() => setMatchOff(B?.sha256 || '')} />
            )}
            {!veteran ? (
              // 往来稿和模板都还空着：不放两张空卡片，一行说明 + “新建模板”
              <div className="home-intro">
                <span>{t('合同要来回改好几轮？比较完可以存成往来稿；常用的标准稿可以存成模板。')}</span>
                <button type="button" className="btn sm" onClick={newTemplate} disabled={libBusy}><I.IconPlusDoc />{t('新建模板')}</button>
              </div>
            ) : (
            <div className="lib-cols">
            <div className="lib-col">
            <ThreadsCard threads={live(lib.threads)} onOpen={(th) => openThread(th)} onRename={(th, name) => updThread(th.id, (x) => ({ ...x, name, updated: Date.now() }))}
              onArchive={(th, on) => updThread(th.id, (x) => ({ ...x, archived: on ? Date.now() : undefined }))} onDelete={deleteThread}>
              {recent.length > 0 && (
                <div className="lib-group">
                  <div className="lib-gh"><span>{t('最近比较')}</span><span className="grow" /><button type="button" className="btn sm plain" onClick={async () => { await api.recentClear?.(); setRecent([]); }}>{t('清空')}</button></div>
                  <div className="lib-rows">
                    {recent.map((r, i) => (
                      <RecentRow key={i} a={r.a} b={r.b} time={timeAgo(r.time)} prog={r.a.sha && r.b.sha ? reviewProgress(pairKey(r.a.sha, r.b.sha)) : null} thread={recentThread(r)}
                        onOpen={() => openRecent(r)} onSave={() => { setPendingSave(true); openRecent(r); }} onRemove={() => api.recentRemove(i).then(setRecent)} />
                    ))}
                  </div>
                </div>
              )}
            </ThreadsCard>
            </div>
            <div className="lib-col">
              <TemplatesCard lib={lib} threadCount={(tid) => live(lib.threads).filter((x) => x.tpl?.tid === tid).length} busy={libBusy} onUse={(tp) => setTplDlg(tp.id)} onNew={newTemplate} onAddVersion={addTplVersion}
                onRename={renameTpl} onDelete={deleteTpl} onDeleteVersion={deleteTplVersion} />
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
        {tplOpen && <TemplateCompareDialog tpl={tplOpen} B={B} bBusy={busy[1]} onPickB={() => open(1)} onDropB={(fs) => fs[0] && loadFile(1, fs[fs.length - 1])} onStart={startFromTemplate} onClose={() => setTplDlg(null)} />}
        {modals}
      </div>
    );
  }

  // =================== 比较界面（规范 3.0：工具栏 + 侧栏 + 画布 + 检查器）===================
  const stats = curRes?.stats;
  const navCount = (i: number): [string | number, string] | undefined =>
    i === 0 && richRes ? [richRes.changes.length, t('含格式与移动的差异总数')]
    : i === 1 && plainRes ? [plainRes.changes.length, t('按行比较、不含格式，所以数字可能和富文本不同')]
    : i === 2 && richRes ? [`${richRes.changes.filter((c) => decisions[c.id]?.v).length}/${richRes.changes.length}`, t('已审阅 / 总数')]
    : i === 4 && ocrRes ? [ocrRes.changes.length, t('按识别出的文字逐行比较')]
    : undefined;
  const navOpen = narrow ? navWide : prefs.navOpen;
  const isRichTab = tab === 0 || tab === 2;
  const hasInsp = tab !== 5;
  const inspOpen = hasInsp && (narrow ? drawer : prefs.asideOpen);
  const shownIdx = shown.findIndex((c) => c.id === selCid);
  const canNav = (tab === 0 || tab === 1 || (tab === 4 && !!ocrRes)) && shown.length > 0;

  // ---------- 画布标题行：左边说明看的是什么，右边是这个模式的视图选项 ----------
  const hideToggle = (on: boolean, onChange: (v: boolean) => void, label: string) => (
    <label className="ch-opt"><Switch on={on} onChange={onChange} label={label} size="sm" />{label}</label>
  );
  let canvasTools: React.ReactNode = null;
  if (tab === 0) canvasTools = hideToggle(prefs.hideRich, set('hideRich'), t('只看有变化的段落'));
  else if (tab === 1 || (tab === 4 && ocrRes)) canvasTools = (<>
    <Seg value={prefs.layout} options={[['split', t('并排')], ['unified', t('合并')]]} onChange={set('layout')} label={t('布局')} />
    {hideToggle(prefs.hidePlain, set('hidePlain'), t('只看有变化的行'))}
  </>);
  else if (tab === 3) canvasTools = (<>
    <Seg value={prefs.imgMode} options={[['split', t('并排')], ['diff', t('差异')], ['fade', t('淡化')], ['slider', t('滑块')]]} onChange={set('imgMode')} label={t('对比方式')} />
    {prefs.imgMode === 'fade' && <input type="range" className="range" style={{ width: 140 }} min={0} max={100} value={fade} onChange={(e) => setFade(Number(e.target.value))} aria-label={t('淡化程度')} title={t('左边是原始，右边是修改后')} />}
    <select className="sel" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} title={t('缩放')} aria-label={t('缩放')}>
      {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
    </select>
  </>);
  if (tab === 4) canvasTools = (<>
    {canvasTools}
    <select className="sel" value={prefs.ocrLang} onChange={(e) => set('ocrLang')(e.target.value as OcrLang)} disabled={ocr.status === 'running'} aria-label={t('识别语言')}>
      <option value="chi_sim+eng">{t('中文 + 英文')}</option><option value="chi_sim">{t('仅中文')}</option><option value="eng">{t('仅英文')}</option>
    </select>
    {ocr.status === 'running' ? <button className="btn sm" onClick={cancelOcr}>{t('取消识别')}</button>
      : ocrRes ? <button className="btn sm" onClick={() => runOcr()}>{t('重新识别')}</button> : null}
  </>);
  const canvasTitle = t(tab === 2 ? '修改后文档' : '原始文档 · 修改后文档');

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
  else if (tab === 3 && needGate && counts) body = <PageRangeGate mode="image" pagesA={counts.a} pagesB={counts.b} initial={pageRanges[pairSha]} onConfirm={setPageRange} />;
  else if (tab === 3) body = <ImageView head={rangeHead} suspect={suspectPages} state={imgState} mode={prefs.imgMode} zoom={zoom} fade={fade} setFade={setFade} slider={slider} setSlider={setSlider} showBoxes={prefs.showBoxes} onlyDiff={onlyDiffPages} scrollRef={imgScroll} />;
  else if (tab === 4) {
    if (ocrRes && ocrBlocks) body = <PlainView A={ocrBlocks[0]} B={ocrBlocks[1]} res={ocrRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} lowWords={lowWords} />;
    else if (ocr.status !== 'running' && needGate && counts) body = <PageRangeGate mode="ocr" pagesA={counts.a} pagesB={counts.b} onConfirm={(r) => { setPageRange(r); runOcr(r); }} />;
    else if (ocr.status === 'running') body = <div className="empty-state"><Mascot mood="think" size={96} /><h2>{t('正在识别文字…')}</h2>{rangeHead}<div>{ocr.msg}</div><div className="progress"><div style={{ width: `${ocr.pct || 0}%` }} /></div><button className="btn sm plain" onClick={cancelOcr}>{t('取消')}</button></div>;
    else body = (
      <div className="empty-state">
        <Mascot mood="sleepy" size={96} />
        <h2>{t('先识别，再比较')}</h2>
        <div>{t('把两份文档的每一页当成图片来识别文字。适合扫描件、截图型 PDF。')}<br />{t('每页大约 3–5 秒，完全离线。')}</div>
        {ocr.status === 'error' && <Notice tone="err" title={t('识别失败')}>{ocr.msg}</Notice>}
        {rangeHead}
        <button className="btn primary big" onClick={() => runOcr()} disabled={!pageRange}>{counts ? t('开始识别') : t('正在统计页数…')}</button>
      </div>
    );
  } else if (tab === 5) body = <DetailsView A={A} B={B} />;

  const showMap = (tab === 0 || tab === 1 || tab === 2 || (tab === 4 && !!ocrRes)) && shown.length > 0;
  const cur = changes.find((c) => c.id === selCid);
  const curIdx = changes.findIndex((c) => c.id === selCid);
  const curDec = cur ? decisions[cur.id] : undefined;

  // ---------- 比较设置（工具栏齿轮的弹出层） ----------
  const compareSettings = tab === 3 ? (
    <>
      <Opt label={t('标出差异区域')}><Switch on={prefs.showBoxes} onChange={set('showBoxes')} label={t('标出差异区域')} /></Opt>
      <Opt label={t('只看有差异的页')}><Switch on={onlyDiffPages} onChange={setOnlyDiffPages} label={t('只看有差异的页')} /></Opt>
      <Opt label={t('灵敏度')}>
        <select className="sel" value={prefs.threshold} onChange={(e) => set('threshold')(Number(e.target.value))} aria-label={t('灵敏度')}>
          <option value={0.03}>{t('很高')}</option><option value={0.1}>{t('标准')}</option><option value={0.2}>{t('较低')}</option><option value={0.35}>{t('低')}</option>
        </select>
      </Opt>
    </>
  ) : (
    <>
      <Opt label={t('忽略空白差异')} hint={t('多余空格、换行符不同')}><Switch on={prefs.ignoreWs} onChange={set('ignoreWs')} label={t('忽略空白差异')} /></Opt>
      <Opt label={t('忽略全角 / 半角标点')} hint={t('，和 ,　（和 (　视为相同')}><Switch on={prefs.normPunct} onChange={set('normPunct')} label={t('忽略全角 / 半角标点')} /></Opt>
      <Opt label={t('忽略大小写')}><Switch on={prefs.ignoreCase} onChange={set('ignoreCase')} label={t('忽略大小写')} /></Opt>
      <Opt label={t('检测移动的段落')}><Switch on={prefs.detectMoves} onChange={set('detectMoves')} label={t('检测移动的段落')} /></Opt>
      {isRichTab && <Opt label={t('检测格式变化')} hint={t(A.type !== B.type ? 'Word 与 PDF 互比时默认关闭' : '加粗、字号、颜色、标题级别')}><Switch on={formatting} onChange={setFormatting} label={t('检测格式变化')} /></Opt>}
      {(tab === 1 || tab === 4) && <Opt label={t('自动换行')}><Switch on={prefs.wrap} onChange={set('wrap')} label={t('自动换行')} /></Opt>}
      <Opt label={t('比较精度')}><Seg value={prefs.precision} options={[['word', t('按词')], ['char', t('按字符')]]} onChange={set('precision')} label={t('比较精度')} /></Opt>
    </>
  );

  // ---------- 检查器 ----------
  let insp: React.ReactNode = null;
  if (tab === 3) {
    const diffPages = imgState.diffs.filter((d) => d.pct >= 0.001).length;
    const susPages = imgState.diffs.filter((d, i) => d.pct < 0.001 && suspectPages.has(d.page ?? i + 1)).length;
    insp = (
      <>
        <div className="sh"><span className="t">{t('页面')}</span>{imgState.diffs.length > 0 && <span className="cnt">{imgState.diffs.length}</span>}</div>
        <div className="insp-sum">
          {needGate ? t('等你选择要比较的页码范围') : !pageRange ? t('正在统计页数…') : imgState.loading && !imgState.diffs.length ? imgState.loading
            : diffPages || susPages ? t('{d} 页有差异 · {s} 页相同', { d: diffPages, s: imgState.diffs.length - diffPages - susPages }) + (susPages ? t(' · {n} 页可能缺字', { n: susPages }) : '') + (imgState.status !== 'done' ? t('（已完成 {d}/{n} 页）', { d: imgState.done, n: imgState.n }) : '')
            : imgState.diffs.length ? (imgState.status === 'done' ? t('每一页在视觉上都没有发现差异。') : t('已比较的 {d} 页没有发现差异，还有 {l} 页没有比较。', { d: imgState.done, l: Math.max(0, imgState.n - imgState.done) })) : null}
        </div>
        <div className="dlist">
          {imgState.diffs.map((d, i) => (
            <button key={i} type="button" className="drow" onClick={() => document.getElementById(`page-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className={`pdot ${d.pct < 0.001 && !d.aMissing && !d.bMissing && !suspectPages.has(d.page ?? i + 1) ? 'same' : 'diff'}`} aria-hidden="true" />
              <span className="tx">{t('第 {n} 页', { n: d.page ?? i + 1 })}</span>
              <span className="meta">{d.aMissing || d.bMissing ? t('缺页') : d.pct < 0.001 ? (suspectPages.has(d.page ?? i + 1) ? t('可能缺字') : t('相同')) : `${d.pct < 0.01 ? '<0.01' : d.pct.toFixed(2)}%`}</span>
            </button>
          ))}
        </div>
        <div className="insp-note">{t('Word 和 TXT 会先在本机排成页面再比较，分页可能和 Word 略有不同。')}</div>
      </>
    );
  } else if (hasInsp) {
    const avg = (xs: number[]) => { const v = xs.filter((x) => x >= 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : -1; };
    insp = (
      <>
        <div className="sh">
          <span className="t">{t(tab === 2 ? '修订' : '差异')}</span>
          {changes.length > 0 && <span className="cnt">{filter !== 'all' ? `${shown.length} / ${changes.length}` : changes.length}</span>}
          {tab === 2 && changes.length > 0 && <button ref={moreRef} type="button" className="ibtn sm act" onClick={() => setPop(pop === 'more' ? null : 'more')} title={t('全部接受 / 全部拒绝')} aria-label={t('更多操作')} aria-expanded={pop === 'more'}><I.IconMore /></button>}
        </div>
        {changes.length > 0 && stats && <FilterChips stats={stats} risks={isRichTab ? risks.length : 0} value={filter} onChange={setFilter} />}
        {changes.length > 0 ? (
          <ChangeList changes={shown} all={changes} sel={selCid} onSel={setSelCid} onHover={hoverCid} decisions={tab === 2 ? decisions : undefined}
            clauses={isRichTab ? clauses : noClauses} risks={isRichTab ? riskById : new Map()} grouped={isRichTab} />
        ) : (
          <div className="insp-empty">
            {curRes ? <><b>{t('在已比较的范围内未发现差异。')}</b>{scope?.notCompared.length ? <span>{t('未比较：{x}', { x: scope.notCompared.join(t('、')) })}</span> : null}</>
              : tab === 4 ? <span>{t('识别完成后，这里会列出差异。')}</span> : null}
          </div>
        )}
        {tab === 4 && ocr.status === 'done' && ocr.conf && (
          <div className="insp-block">
            <div className="sh"><span className="t">{t('识别质量')}</span></div>
            {rangeHead}
            {[0, 1].map((s) => (
              <div className="conf-row" key={s}>
                <span>{sideLabel(s as Side)}</span>
                <span className="conf-pages">{ocr.conf![s].map((c, i) => <span key={i} className={`conf-pg ${c < 0 ? '' : c < 80 ? 'low' : 'ok'}`} title={t('第 {n} 页：{c}%', { n: (pageRange?.from ?? 1) + i, c: c < 0 ? '—' : Math.round(c) })} />)}</span>
                <b>{avg(ocr.conf![s]) < 0 ? '—' : `${avg(ocr.conf![s])}%`}</b>
              </div>
            ))}
            {[...ocr.conf[0], ...ocr.conf[1]].some((c) => c >= 0 && c < 80) && <div className="insp-note">{t('有页面识别把握不高，结果仅供参考。虚线标出的是没认准的字。')}</div>}
          </div>
        )}
        {tab === 2 && activeTh && thread && cur && clauses.get(cur.id) && (
          <ClauseHistory clause={clauses.get(cur.id)!} items={clauseHistory(activeTh, clauses.get(cur.id)!, thread.b)} th={activeTh} />
        )}
        {isRichTab && scope && (
          <div className="insp-foot">
            <span className="k">{t('比较范围')}</span>
            <span className="v" title={scopeLine(scope)}>{scopeLine(scope)}</span>
            {scope.degraded && <span className="tag hold sm">{t('简化对齐')}</span>}
            <button ref={scopeRef} type="button" className="link-btn" onClick={() => setPop(pop === 'scope' ? null : 'scope')} aria-expanded={pop === 'scope'}>{t('详情')}</button>
          </div>
        )}
      </>
    );
  }

  const crossFormat = A.type !== B.type && (A.type === 'pdf' || B.type === 'pdf') && isRichTab && dismissCross !== docSig;
  const askReviewer = tab === 2 && changes.length > 0 && !prefs.reviewerAsked;
  const toggleTitle = (open: boolean, what: string, key: string) => `${t(open ? '收起{w}' : '展开{w}', { w: t(what) })}（${key}）`;
  const navKey = isMac ? '⌃⌘S' : 'Ctrl+Alt+S', inspKey = isMac ? '⌥⌘I' : 'Ctrl+Alt+I';

  return (
    <div className={`app shell ${navOpen ? '' : 'nav-mini'} ${hasInsp && inspOpen && !narrow ? '' : 'insp-off'} ${narrow ? 'narrow' : ''}`}>
      <nav className="nav" aria-label={t('比较模式')}>
        {navOpen && (
          <div className="nav-h drag">
            {!isMac && <Wordmark size={26} />}
            <span className="grow" />
            <button type="button" className="ibtn" onClick={toggleNav} title={toggleTitle(true, '侧栏', navKey)} aria-label={t('收起侧栏')} aria-expanded={true}><I.IconPanelLeft /></button>
          </div>
        )}
        <div className="sh"><span className="t">{t('比较模式')}</span></div>
        <div className="nav-list">
          {MODES.map((m, i) => {
            const n = navCount(i);
            return (
              <button key={i} type="button" className={`nav-item ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)} title={`${t(m.label)}（${kbd(`mod+${i + 1}`)}）${n ? ' · ' + n[1] : ''}`} aria-current={tab === i ? 'page' : undefined}>
                <span className={`mi mc-${m.c}`} aria-hidden="true">{m.g}</span><span className="lbl">{t(m.label)}</span>{n !== undefined && <span className="count">{n[0]}</span>}
              </button>
            );
          })}
        </div>
        <div className="spacer" />
        <div className="nav-foot">
          <button type="button" className="nav-item" onClick={clearAll} title={t('新建比较')}><span className="fi" aria-hidden="true"><I.IconPlusDoc /></span><span className="lbl">{t('新建比较')}</span></button>
          <button type="button" className="nav-item" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t(theme === 'dark' ? '浅色模式' : '深色模式')}><span className="fi" aria-hidden="true">{theme === 'dark' ? <I.IconSun /> : <I.IconMoon />}</span><span className="lbl">{t(theme === 'dark' ? '浅色模式' : '深色模式')}</span></button>
          <button type="button" className={`nav-item${updBadge ? ' has-dot' : ''}`} onClick={() => setShowSettings('general')} title={t(updBadge ? '设置（有新版本）' : '设置')}><span className="fi" aria-hidden="true"><I.IconGear /></span><span className="lbl">{t('设置')}</span></button>
        </div>
      </nav>

      <header ref={tbRef} data-level="0" className={`tbar drag${draftSync && tab === 2 ? ' has-draft' : ''}`}>
        {!navOpen && <button type="button" className="ibtn tb-nav" onClick={toggleNav} title={toggleTitle(false, '侧栏', navKey)} aria-label={t('展开侧栏')} aria-expanded={false}><I.IconPanelLeft /></button>}
        {activeTh && thread ? (
          <VersionChip th={activeTh} a={thread.a} b={thread.b} tpl={activeTh.tpl ? lib.templates.find((x) => x.id === activeTh.tpl!.tid) : null}
            progress={(v) => { const i = activeTh.versions.indexOf(v); const r = i > 0 ? roundOf(activeTh, activeTh.versions[i - 1].id, v.id) : null; return r ? (r.decided >= r.total ? t('已审完') : t('已审 {d} / {n}', { d: r.decided, n: r.total })) : t('未审'); }}
            onPick={(a, b) => openThread(activeTh, a, b)} onAdd={() => setAddVer({ id: activeTh.id, f: null })}
            onDropFiles={(fs) => { if (fs[0]?.path) setAddVer({ id: activeTh.id, f: fs[0] }); else if (fs[0]) flash(t('这个文件没有路径，请用“选择”打开')); }}
            onRename={(name) => updThread(activeTh.id, (x) => ({ ...x, name, updated: Date.now() }))} />
        ) : (<>
        <FilePill side={0} doc={A} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} changed={changedSides.includes(0)} />
        <button type="button" className="ibtn" title={t('交换左右（{k}）', { k: kbd('mod+shift+S') })} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button>
        <FilePill side={1} doc={B} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} changed={changedSides.includes(1)} />
        </>)}
        {(busy[0] || busy[1]) && <div className="spinner sm" />}
        <div className="tb-mid">
          {tab === 2 && changes.length > 0 ? (
            <>
              <div className="tb-prog" role="progressbar" aria-valuemin={0} aria-valuemax={changes.length} aria-valuenow={decidedCount} aria-label={t('审阅进度')}><i style={{ width: `${(decidedCount / changes.length) * 100}%` }} /></div>
              <span className="tb-pos">{decidedCount} / {changes.length}</span>
            </>
          ) : canNav ? (
            <>
              <button type="button" className="ibtn" onClick={() => go(-1)} title={t('上一处（K）')} aria-label={t('上一处')}><I.IconUp /></button>
              <span className="tb-pos">{shownIdx < 0 ? t('共 {n} 处', { n: shown.length }) : t('第 {i} / {n} 处', { i: shownIdx + 1, n: shown.length })}</span>
              <button type="button" className="ibtn" onClick={() => go(1)} title={t('下一处（J）')} aria-label={t('下一处')}><I.IconDown /></button>
            </>
          ) : null}
        </div>
        {tab !== 5 && <button ref={gearRef} type="button" className="ibtn" onClick={() => setPop(pop === 'settings' ? null : 'settings')} title={t('比较设置')} aria-label={t('比较设置')} aria-expanded={pop === 'settings'}><I.IconGear /></button>}
        {curRes && <button type="button" className="btn tb-copy" onClick={copySummary} title={t('复制为 Markdown，可粘贴到邮件 / 飞书 / 文档')} aria-label={t('复制摘要')}><I.IconCopy /><span className="lbl">{t('复制摘要')}</span></button>}
        {richRes && tab === 2 && draftSync && B && (
          <DraftChip state={draftState} sync={draftSync} bPath={B.file.path} narrow={false} finalReq={finalReq} hideTip={tab === 2 && doneOpen} origLabel={origLabel} decided={richRes.changes.filter((c) => decisions[c.id]?.v).length}
            pending={richRes.changes.filter((c) => !decisions[c.id]?.v || decisions[c.id]?.v === 'h').length} held={heldN} onFinal={(p) => { setFinalMade(p); if (allDecided) setDoneOpen(true); return allDecided; }} finalPattern={prefs.finalName.trim() || t('{name}-定稿')}
            onJump={(cid) => { setTab(2); setFilter('all'); setSelCid(cid); }} flash={flash} />
        )}
        {richRes && isRichTab && <button type="button" className={`btn tb-export ${tab === 2 ? '' : 'primary'}`} onClick={openExport} title={t('导出')} aria-label={t('导出')}><I.IconExport /><span className="lbl">{t('导出')}</span></button>}
        {hasInsp && <button type="button" className="ibtn" onClick={toggleAside} title={toggleTitle(inspOpen, '检查器', inspKey)} aria-label={t(inspOpen ? '收起检查器' : '展开检查器')} aria-expanded={inspOpen}><I.IconPanelRight /></button>}
      </header>

      <main className="center">
        <div className="ch">
          <span className="t">{canvasTitle}</span>
          <span className="grow" />
          {canvasTools}
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
        {readIssueDocs.length > 0 && hideReadWarn !== docSig && (
          <Notice tone="err" className="bar read-warn" role="alert" title={t('有些文字没能读出来，比较结果可能不完整。')}
            action={<>
              {readIssueDocs.some(([, d]) => d.readIssues!.kinds.includes('nounicode')) && tab !== 4 && <button className="btn sm" onClick={() => setTab(4)}>{t('改用 OCR 文本比较')}</button>}
              {readIssueDocs.map(([i, d]) => d.file.path && <button key={i} className="btn sm" onClick={() => api.openExternalFile?.(d.file.path)}>{t('用其他阅读器打开{s}', { s: sideLabel(i as Side) })}</button>)}
            </>}
            onClose={() => setHideReadWarn(docSig)} closeLabel={t('知道了')}>
            {readIssueDocs.map(([i, d]) => t('{s}第 {p} 页有 {n} 段文字{why}，', { s: sideLabel(i as Side), p: pageList(d.readIssues!.pages), n: d.readIssues!.runs, why: d.readIssues!.kinds.includes('font') ? t('的字体无法解析') : t('没有字符映射') })).join('')}
            {t('这些内容没有参与比较，“没有差异”不代表这些地方相同。请在其他阅读器里打开原文件核对这几页。')}
          </Notice>
        )}
        {persist.review && (
          <Notice tone="warn" className="bar persist-warn" role="alert" title={t('审阅结论没能保存到本机。')}
            action={<button className="btn sm" onClick={() => { if (richRes && decFor.current === richRes) saveDecisions(pk, richRes.changes, decisions); }}>{t('重试保存')}</button>}>
            {t('结论还在这个窗口里，没有丢；关闭窗口前可以先导出 Word 修订稿或比对报告。下一次保存成功后，这条提示会自动消失。')}<small className="persist-err">{persist.review}</small>
          </Notice>
        )}
        {(persist.settings || persist.recent) && hideSetWarn !== (persist.settings || persist.recent) && (
          <Notice tone="warn" className="bar persist-warn" title={t(persist.settings ? '设置没能保存到本机。' : '“最近比较”没能保存到本机。')} onClose={() => setHideSetWarn(persist.settings || persist.recent || '')}>
            {t('这次的改动下次打开可能就没有了。请检查磁盘空间和应用数据目录的写入权限。')}<small className="persist-err">{persist.settings || persist.recent}</small>
          </Notice>
        )}
        {crossFormat && (
          <Notice className="bar" role="note" title={t('跨格式比对。')}
            action={!formatting && <button className="btn sm" onClick={() => setFormatting(true)}>{t('检测格式差异')}</button>} onClose={() => setDismissCross(docSig)}>
            {t('PDF 的文字是从版面推断的，段落和表格可能被拆开。')}{formatting ? t('格式差异已检测，但 PDF 的格式信息不完整。') : t('格式差异（加粗、字号等）没有检测。')}
          </Notice>
        )}
        {(errs[0] || errs[1]) && <Notice tone="err" className="bar" title={errs[0] || errs[1]} />}
        {curRes?.degraded && !dismissDegraded && (
          <Notice tone="warn" className="bar" title={t('这次用了简化的段落对齐')} onClose={() => setDismissDegraded(true)}>
            {curRes.degraded.pairFallback
              ? t('两份文档差异太大（单个区段 {n} 组比较），为了不卡死改用了按位置粗配，段落对应关系可能不准。', { n: curRes.degraded.maxRegion.toLocaleString() })
              : t('差异区段过大，本次没有识别段落的拆分与合并。')}
          </Notice>
        )}
        <div className="main">
          {body}
          {showMap && <ChangeMap changes={changes} filter={filter === 'all' || filter === 'risk' ? [] : [filter]} selCid={selCid} onSel={setSelCid} dep={[curRes, tab, prefs.hideRich, prefs.hidePlain, prefs.layout, prefs.wrap, decisions, inspOpen, navOpen, askReviewer]} />}
        </div>
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
          <div className={`review-bar ${feedback ? 'fb-' + feedback : curDec?.v ? 'is-' + curDec.v : ''}`}>
            <span className={`nb k-${cur?.kind || 'mod'} ${curDec?.v ? 'v-' + curDec.v : ''}`} aria-hidden="true">{curDec?.v === 'a' ? '✓' : curDec?.v === 'r' ? '✕' : curDec?.v === 'h' ? '?' : curIdx + 1 || '·'}</span>
            <div className="rb-info">
              {feedback ? (
                <span className="fb" role="status">{t(VERDICT_FB[feedback])}</span>
              ) : cur ? (
                <span className="rb-where">
                  {cur.sec && cur.sec !== 'body' ? t(cur.sec === 'header' ? '页眉' : cur.sec === 'footer' ? '页脚' : '脚注') : clauses.get(cur.id) ?? t('开头部分')}
                  {' · '}{KIND_LABEL[cur.kind]}{' · '}{t('第 {i} / {n} 处', { i: curIdx + 1, n: changes.length })}
                  {riskById.get(cur.id) && <span className="rk">⚠<span>{riskTag(riskById.get(cur.id)!)}</span></span>}
                  {curDec?.v && <span className="rb-dec">{t(VERDICT_SHORT[curDec.v])}{curDec.by ? ` · ${curDec.by}` : ''}</span>}
                  {persist.review && <span className="rb-unsaved" title={persist.review}>{t('未保存')}</span>}
                </span>
              ) : <span className="rb-where">{t('点文中任意一处修订开始审阅')}</span>}
              {cur && <div className="rb-diff">{cur.kind === 'mod' ? <><del>{short(cur.before, 60)}</del><span className="arrow">→</span><ins>{short(cur.after, 60)}</ins></> : cur.kind === 'ins' ? <ins>{short(cur.after, 120)}</ins> : cur.kind === 'del' ? <del>{short(cur.before, 120)}</del> : cur.kind === 'fmt' ? <>{short(cur.before, 60)}<em>（{noteText(cur)}）</em></> : <>{short(cur.before, 100)}<em>（{t('整段移动')}）</em></>}</div>}
              {cur && activeTh && hints.get(cur.id) && <HintLine hint={hints.get(cur.id)!} th={activeTh} onReuse={(v) => decide(cur.id, v)} />}
              <label className="rb-note">
                <input id="note-input" ref={noteRef} disabled={!cur} value={cur ? decisions[cur.id]?.note || '' : ''} placeholder={t('备注（可选），会写进 Word 批注')}
                  onChange={(e) => cur && setNote(cur.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} aria-label={t('备注')} />
                <Kbd>N</Kbd>
              </label>
            </div>
            <div className="rb-acts">
              <button className="chip as-btn" onClick={() => setShowSettings('review')} title={t('审阅人：{n}（点击修改）', { n: reviewer })}><span className="av">{(prefs.reviewerInitials || initialsOf(reviewer)).slice(0, 2)}</span>{reviewer}</button>
              <button className="btn red" disabled={!cur} onClick={() => decide(selCid, 'r')}>{t('拒绝')}<Kbd>R</Kbd></button>
              <button className="btn hold" disabled={!cur} onClick={() => decide(selCid, 'h')}>{t('待议')}<Kbd>H</Kbd></button>
              <button className="btn primary" disabled={!cur} onClick={() => decide(selCid, 'a')}>{t('接受')}<Kbd>A</Kbd></button>
            </div>
          </div>
        )}
        {tab === 2 && doneOpen && (
          <div className="overlay-bg">
            {prefs.celebrate && !finalMade && <Confetti />}
            <div className="done-card" role="dialog" aria-label={t('审阅完成')}>
              <Mascot mood="cheer" size={120} className="mascot-pop" />
              <h2>{t('全部看完了！')}</h2>
              {/* 待议算看完，但不等于谈定（beta.7） */}
              <div className="muted">{heldN > 0 ? t('已看完 {n} 处修订，{h} 处待议', { n: changes.length, h: heldN }) : t('{n} 处修订全部处理完毕', { n: changes.length })}</div>
              <div className="done-stats">
                {(['a', 'r', 'h'] as Verdict[]).map((v) => <div key={v} className={`done-stat ${v}`}><div className="h">{t(v === 'a' ? '接受' : v === 'r' ? '拒绝' : '待议')}</div><div className="v">{changes.filter((c) => decisions[c.id]?.v === v).length}</div></div>)}
              </div>
              {doneActs}
            </div>
          </div>
        )}
      </main>

      {hasInsp && inspOpen && <aside className={`insp ${narrow ? 'drawer' : ''}`} aria-label={t('检查器')}>{insp}</aside>}
      {hasInsp && inspOpen && narrow && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}

      <Popover anchor={gearRef} open={pop === 'settings'} onClose={closePop} title={t('比较设置')}>{compareSettings}</Popover>
      <Popover anchor={scopeRef} open={pop === 'scope'} onClose={closePop} title={t('比较范围')} width={360} align="end">{scope && <ScopeBody scope={scope} />}</Popover>
      <Popover anchor={moreRef} open={pop === 'more'} onClose={closePop} width={260} className="menu" label={t('更多')}>
        <MenuItem icon={<I.IconCheck />} onClick={() => { closePop(); setBulkAsk('a'); }}>{t('全部接受…')}</MenuItem>
        <MenuItem icon={<I.IconX />} tone="danger" onClick={() => { closePop(); setBulkAsk('r'); }}>{t('全部拒绝…')}</MenuItem>
        {draftSync && <MenuItem icon={<I.IconPlusDoc />} onClick={() => { closePop(); setFinalReq((n) => n + 1); }}>{t('生成定稿…')}</MenuItem>}
        {decidedCount > 0 && <MenuItem icon={<I.IconRefresh />} onClick={() => { closePop(); setBulkAsk('reset'); }}>{t('重置所有决定…')}</MenuItem>}
        {reusable.length > 0 && <MenuItem icon={<I.IconClock />} onClick={() => { closePop(); setReuseAsk(true); }}>{t('沿用上轮结论…（{n} 处）', { n: reusable.length })}</MenuItem>}
        {!activeTh && A && B && A.file.path && B.file.path && <MenuItem icon={<I.IconPlusDoc />} onClick={() => { closePop(); saveAsThread(); }}>{t('存为往来稿')}</MenuItem>}
      </Popover>
      {reuseAsk && (
        <Modal title={t('沿用上轮结论')} onClose={() => setReuseAsk(false)}
          footer={<><button type="button" className="btn" onClick={() => setReuseAsk(false)}>{t('取消')}</button><button type="button" className="btn primary" onClick={applyReuse}>{t('沿用 {n} 处', { n: reusable.length })}</button></>}>
          <ul className="bulk-lines">
            {reusable.filter((x) => x.h.kind === 'reverted').length > 0 && <li>{t('{n} 处是你上轮拒绝、对方又改回来的：沿用“拒绝”', { n: reusable.filter((x) => x.h.kind === 'reverted').length })}</li>}
            {reusable.filter((x) => x.h.kind === 'repeat').length > 0 && <li>{t('{n} 处和上轮的修改一模一样：沿用上轮的结论', { n: reusable.filter((x) => x.h.kind === 'repeat').length })}</li>}
            <li>{t('只改还没有结论的处；已经决定过的不动。')}</li>
          </ul>
          <p className="bulk-note">{t('做完 10 秒内可以撤销，回到操作前的全部结论。')}</p>
        </Modal>
      )}
      {addVer && (() => { const th = lib.threads.find((x) => x.id === addVer.id); return th ? (
        <AddVersionDialog th={th} file={addVer.f} busy={libBusy} onClose={() => setAddVer(null)} onDropFiles={(fs) => { if (fs[0]?.path) setAddVer({ id: th.id, f: fs[0] }); else if (fs[0]) flash(t('这个文件没有路径，请用“选择”打开')); }}
          onPick={async () => { const f: FileInfo | null = await api.openDialog(); if (f) setAddVer({ id: th.id, f }); }}
          onDone={(side, against) => { const f = addVer.f!; setAddVer(null); addThreadVersion(th, f, side, against); }} />) : null; })()}
      {modals}
    </div>
  );
}
