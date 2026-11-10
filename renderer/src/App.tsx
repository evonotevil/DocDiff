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
import { t, setLang, initLang, Lang, isEn, fmtAgo, fmtShortDate, colon } from './lib/i18n';
import { clauseMap, rowClauses, detectRisks, DEFAULT_KEYWORDS, defaultKeywords, Risk } from './lib/insight';
import { buildThreads, cmView, internalComments, bestFor, authorsOf, normName, live as cmLive, type CmThread, type Owner } from './lib/comments';
import { loadCm, saveCm, type CmState } from './lib/commentStore';
import { CommentPop, CommentList, CommentHint, DropInternalModal, type CardActs } from './components/Comments';
import { DecMap, Dec, Verdict, pairKey, loadDecisions, saveDecisions, reviewProgress, initialsOf } from './lib/review';
import { scopeInfo, pageList } from './lib/scope';
import { getSetting, setSetting as saveSetting, usePersistStatus } from './lib/persist';
import { summaryMarkdown, reportHtml } from './lib/report';
import { ChangeList, KIND_LABEL, short } from './components/ChangeList';
import { ChangeMap } from './components/ChangeMap';
import { FilterChips, Filter, ScopeBody, scopeLine } from './components/Panels';
import { Notice } from './components/Panel';
import { Popover, MenuItem } from './components/Popover';
import { FindBar, FindAll } from './components/FindBar';
import { ExportDialog, ExportKind } from './components/ExportDialog';
import { SettingsModal, SettingsValues, UpdInfo, APP_VERSION, type Tab as SettingsTab } from './components/SettingsModal';
import { Modal } from './components/Modal';
import { Mascot, Confetti, MascotOn, Bubble, useFade } from './components/Mascot';
import { HomePeek, ReviewPeek, useReviewPeek, WaitMascot, useCare } from './components/MascotScenes';
import { markSeen, countCompare, gate as mascotGate } from './lib/mascot/store';
import { Wordmark } from './components/Logo';
import { Switch, Opt, Seg, Kbd, useMedia, splitName, MidName, TypeTag, Info } from './components/ui';
import { Select, Slider, TextInput, Textarea, Checkbox } from './components/Form';
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
import { DraftSync, cleanStem, type DraftState, type DraftBehind, flushDrafts, onDraftBackground, pendingDrafts, mutePending } from './lib/draft/client';
import { DraftChip, REASON } from './components/DraftChip';
import { DemoDialog, type DemoKind } from './components/Demo';
import { KeysModal } from './components/SettingsModal';
import { TemplatesCard, TemplateCompareDialog, MatchNotice, RecentRow, EmptyCard } from './components/Library';
import { ThreadsList, VersionChip, AddVersionDialog, HintLine, ClauseHistory } from './components/Thread';
import { hintsFor, clauseHistory } from './lib/hints';
import { chime, warmChimes } from './lib/chime';
import { type Library, type Template, type TplVersion, type Thread, type ThreadVersion, type Side as LibSide, type Round, EMPTY_LIB, loadLibrary, loadRounds, saveLibrary, putFile, readVersion, fingerprint, pick, versionLabel, stemOf, live, uid, UNDO_MS, defaultPair, roundOf, matchThreads, dropVersion } from './lib/library';

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
  /** 1.9.1：忽略引号样式（直引号 / 弯引号），默认开 */
  normQuotes: boolean;
  hideRich: boolean; hidePlain: boolean; layout: 'split' | 'unified'; wrap: boolean;
  imgMode: ImgMode; threshold: number; showBoxes: boolean; ocrLang: OcrLang; sound: boolean;
  navOpen: boolean; asideOpen: boolean;
  autoCheckUpdate: boolean; skipVersion: string;
  // 1.6
  reviewerName: string; reviewerInitials: string; reviewerAsked: boolean;
  authorName: string; commentAccepted: boolean;
  riskMoney: boolean; riskDate: boolean; keywords: string[];
  paperFollowTheme: boolean; celebrate: boolean;
  /** 1.9：让对对出来走走（默认开） */
  mascotWalk: boolean;
  // 1.8：审阅稿、定稿的文件名，{name} = 对方文件名
  draftName: string; finalName: string;
  /** 以前的审阅稿被删了或挪走了：自动重新生成 / 先问我（beta.6） */
  draftMissing: 'auto' | 'ask';
  /** 1.9.5：我方成员（批注作者是这些名字时算我方） */
  ourMembers: string[];
}
const sysUser = (() => { try { return String(api.userName?.() || ''); } catch { return ''; } })();
const DEFAULT_PREFS: Prefs = {
  ignoreCase: false, ignoreWs: true, precision: 'word', detectMoves: true, normPunct: false, normQuotes: true,
  hideRich: false, hidePlain: false, layout: 'split', wrap: true,
  imgMode: 'split', threshold: 0.1, showBoxes: true, ocrLang: 'chi_sim+eng', sound: true,
  navOpen: true, asideOpen: true,
  autoCheckUpdate: true, skipVersion: '',
  reviewerName: sysUser, reviewerInitials: initialsOf(sysUser), reviewerAsked: false,
  authorName: '', commentAccepted: true,
  riskMoney: true, riskDate: true, keywords: DEFAULT_KEYWORDS,
  paperFollowTheme: false, celebrate: false, mascotWalk: true,
  draftName: '', finalName: '', draftMissing: 'auto', ourMembers: [],
};
function loadPrefs(): Prefs {
  // 1.9：没设过关键词时按界面语言给默认值（loadPrefs 在 initLang 之后）
  const base = { ...DEFAULT_PREFS, keywords: defaultKeywords(isEn()) };
  try { const v = getSetting('prefs-v2'); return { ...base, ...(typeof v === 'string' ? JSON.parse(v) : v || {}) }; } catch { return base; }
}

// ---------- 音效：见 lib/chime.ts（1.9.2 起不用 AudioContext，避免第一次审阅决定卡主线程） ----------

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
  if (isEn()) return s < 86400 * 7 ? fmtAgo(s) : fmtShortDate(ts); // 1.9：英文交给 Intl
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
        <div className="acts"><button className="btn sm" onClick={onOpen}><I.IconUpload />{t('更换')}</button><button className="btn sm" onClick={onClear}>{t('移除')}</button></div>
      ) : (
        <div className="acts"><button className="btn sm blue" onClick={onOpen} title={`${t('选择文件')} · ${kbd(side ? 'mod+shift+O' : 'mod+O')}`}><I.IconUpload />{t('选择文件')}</button><button className="btn sm" onClick={onPaste}><I.IconPaste />{t('粘贴')}</button></div>
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
          {/* 1.9.1：不带类型的通用文档图标（以前的半透明 TXT 图标像“已经放了一个 TXT”） */}
          <I.DocGeneric size={56} />
          <div className="title">{t('拖入{s}', { s: sideLabel(side) })}</div>
          <div className="hint">{t('支持 Word（.docx）、PDF、TXT')}</div>
          <div className="acts">
            <button className="btn blue" onClick={onOpen} title={`${t('选择文件')} · ${kbd(side ? 'mod+shift+O' : 'mod+O')}`}><I.IconUpload />{t('选择文件')}</button>
            <button className="btn" onClick={onPaste}><I.IconPaste />{t('粘贴文字')}</button>
          </div>
        </>
      )}
      {error && <Notice tone="err" className="stack" title={error} />}
    </div>
  );
}


/** 文件片（规范 3.0）：工具栏左侧，高 36。点一下弹出小菜单（1.9.1：换一个文件… / 存为往来稿）；也可以直接把文件拖上来替换 */
function FilePill({ side, doc, onOpen, onFiles, changed, onSave }: { side: Side; doc: DocModel; onOpen: () => void; onFiles: (f: FileInfo[]) => void; changed: boolean; onSave?: () => void }) {
  const d = useDrop(onFiles);
  const ref = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  return (
    <>
      <button ref={ref} type="button" className={`filechip ${d.over ? 'over' : ''}${menu ? ' open' : ''}`} {...d.props} onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}
        title={`${doc.file.path || doc.file.name}\n${t('点一下换文件或存为往来稿，也可以直接把文件拖进来')}`} aria-label={`${sideLabel(side)}：${doc.file.name}`}>
        <span className={`badge ${doc.type}`}>{doc.type.toUpperCase()}</span>
        <span className="who">{t(side ? '修改后' : '原始')}</span>
        <span className="name">{(() => { const [h, tl] = splitName(doc.file.name); return <><span className="fn-h">{h}</span><span className="fn-t">{tl}</span></>; })()}</span>
        {changed && <span className="chg-dot" title={t('已更新')} />}
      </button>
      <Popover anchor={ref} open={menu} onClose={() => setMenu(false)} width={240} align="start" className="pop-menu filechip-menu" label={doc.file.name}>
        <MenuItem icon={<I.IconUpload />} onClick={() => { setMenu(false); onOpen(); }}>{t('换一个文件…')}</MenuItem>
        {onSave && <MenuItem icon={<I.IconPlusDoc />} onClick={() => { setMenu(false); onSave(); }}>{t('存为往来稿')}</MenuItem>}
      </Popover>
    </>
  );
}

function PasswordModal({ name, wrong, onOk, onCancel }: { name: string; wrong: boolean; onOk: (p: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title={t('这个 PDF 有密码')} mood="think" onClose={onCancel} footer={<><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" onClick={() => onOk(v)}>{t('打开')}</button></>}>
      <p>{t('「{f}」受密码保护。', { f: name })}{wrong && <b className="danger-text">{t('密码不对，再试一次。')}</b>}</p>
      <TextInput size="l" type="password" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && onOk(v)} placeholder={t('输入密码')} aria-label={t('输入密码')} />
    </Modal>
  );
}

function PasteModal({ side, onOk, onCancel }: { side: Side; onOk: (t: string) => void; onCancel: () => void }) {
  const [v, setV] = useState('');
  return (
    <Modal title={t('粘贴{s}的文字', { s: sideLabel(side) })} onClose={onCancel} className="wide"
      footer={<><button className="btn plain" onClick={onCancel}>{t('取消')}</button><button className="btn primary" disabled={!v.trim()} onClick={() => onOk(v)}>{t('使用这段文字')}</button></>}>
      <p>{t('直接粘贴从网页、邮件、聊天软件里复制的内容。')}</p>
      <Textarea autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={t('在这里粘贴…（{k}）', { k: kbd('mod+V') })} aria-label={t('粘贴文字')} />
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

/** 可暂停的计时器（1.9）：鼠标停在提示上、或焦点在里面时暂停，离开后继续剩下的时间 */
function pausableTimer() {
  let t: any = 0, end = 0, left = 0, fn: () => void = () => {}, paused = false;
  return {
    set(f: () => void, ms: number) { clearTimeout(t); paused = false; fn = f; end = Date.now() + ms; t = setTimeout(() => { t = 0; f(); }, ms); },
    clear() { clearTimeout(t); t = 0; paused = false; },
    pause() { if (paused || !t) return; clearTimeout(t); t = 0; left = Math.max(0, end - Date.now()); paused = true; },
    resume(min = 0) { if (!paused) return; paused = false; const ms = Math.max(min, left); end = Date.now() + ms; t = setTimeout(() => { t = 0; fn(); }, ms); },
  };
}

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
  // 提示音打开时，进入修订审阅就在空闲时间把提示音准备好（不开音频设备，不阻塞）
  useEffect(() => { if (tab === 2 && prefs.sound) warmChimes(); }, [tab, prefs.sound]);
  const set = <K extends keyof Prefs>(k: K) => (v: Prefs[K]) => setPrefs((p) => ({ ...p, [k]: v }));
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const [formatting, setFormatting] = useState(true);
  // 1.9.3（F13）：格式变化太密时提示“只看文字修改”。fmtOff = 点了之后（只对这一对文件，可恢复）
  const [fmtOff, setFmtOff] = useState<{ pk: string; n: number } | null>(null);
  const [recent, setRecent] = useState<any[]>([]);
  const [changedSides, setChangedSides] = useState<Side[]>([]);
  const [selCid, setSelCid] = useState<number | null>(null);
  const [decisions, setDecisions] = useState<DecMap>({});
  const [feedback, setFeedback] = useState<Verdict | null>(null);
  const [doneOpen, setDoneOpen] = useState(false);
  // 1.9 · M5：每次打开完成页随机一种欢呼
  const doneFlavor = useMemo(() => Math.random() < 0.5, [doneOpen]);
  // 批量操作先确认，做完可撤销（1.7.3）
  const [bulkAsk, setBulkAsk] = useState<null | 'a' | 'r' | 'reset'>(null);
  // scope：'home' = 首页删除往来稿 / 模板；否则是这一对文件的 pk（批量决定、沿用上轮）。1.9 · QA P1：撤销不能串到别的动作、别的文件
  const [undoToast, setUndoToast] = useState<null | { msg: string; obj?: string; undo: () => void; scope: string }>(null);
  const undoRef = useRef(undoToast);
  // 提示收起了（点 ×、被新提示替换、超时）：暂停中的真正清除继续走完，不能永远停着
  useEffect(() => { if (!undoToast) purgeTimer.current.resume(0); }, [undoToast]);
  undoRef.current = undoToast;
  /** 审阅类的撤销提示（批量、沿用上轮）只对“紧接着的下一步”有效：之后又做了别的，就收起，U 回到撤销单步决定 */
  // 'home'：首页的删除；'lib'：往来稿里删一版（1.9.1），在比较页里也能撤销，换一对比较也不作废
  const dropReviewUndo = () => { if (undoRef.current && undoRef.current.scope !== 'home' && undoRef.current.scope !== 'lib') { undoTimer.current.clear(); undoRef.current = null; setUndoToast(null); } };
  const undoTimer = useRef(pausableTimer());
  /** 删除模板 / 往来稿后真正清掉的计时器，和撤销提示的计时器分开：中途做别的批量操作不会把清理取消掉 */
  const purgeTimer = useRef(pausableTimer());
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
  const homeNarrow = useMedia('(max-width: 1099px)');
  const [navWide, setNavWide] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const toggleNav = () => (narrow ? setNavWide((v) => !v) : setPrefs((p) => ({ ...p, navOpen: !p.navOpen })));
  const toggleAside = () => (narrow ? setDrawer((v) => !v) : setPrefs((p) => ({ ...p, asideOpen: !p.asideOpen })));

  useEffect(() => { document.documentElement.dataset.theme = theme; saveSetting('theme', theme); api.setTheme?.(theme); }, [theme]);
  useEffect(() => { document.documentElement.dataset.paper = prefs.paperFollowTheme ? 'theme' : 'light'; }, [prefs.paperFollowTheme]);
  useEffect(() => { saveSetting('prefs-v2', prefs); }, [prefs]);
  useEffect(() => { api.setLang?.(lang); }, []);
  useEffect(() => { api.recentGet?.().then(setRecent); }, [compared]);
  const toastTimer = useRef(pausableTimer());
  const flash = (m: string, moment?: string) => { toastTimer.current.clear(); setToast(m); toastTimer.current.set(() => setToast(null), 3200); if (moment) cheer(moment); };
  // 完成一件事的瞬间（1.9 · M10）：对对在提示条左边一闪而过 1.2 秒；同一种 30 秒内最多一次；出错的提示不加
  const [moment, setMoment] = useState<null | { act: string; n: number }>(null);
  const momentT = useRef<any>(0);
  const cheer = (act: string) => {
    if (!prefsRef.current.mascotWalk || !mascotGate('moment:' + act)) return;
    setMoment({ act, n: Date.now() }); clearTimeout(momentT.current); momentT.current = setTimeout(() => setMoment(null), 1200);
  };

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
  const threadRef = useRef(thread);
  // 1.9.1 F3：查找栏
  const [findOpen, setFindOpen] = useState(false);
  const [findKey, setFindKey] = useState(0);
  const mainRef = useRef<HTMLDivElement>(null);
  threadRef.current = thread;
  const [addVer, setAddVer] = useState<{ id: string; f: FileInfo | null } | null>(null);
  const activeTh = thread ? lib.threads.find((x) => x.id === thread.id && !x.deleted) || null : null;
  const loadPair = async (va: { file: any; orig?: string }, vb: { file: any; orig?: string } | FileInfo, bIsFile = false) => {
    const fa = await readVersion(va);
    const fb = bIsFile ? (vb as FileInfo) : await readVersion(vb as any);
    if (!fa || !fb) { flash(t('往来稿里的文件不见了')); return false; }
    await Promise.all([loadFile(0, fa), loadFile(1, fb)]);
    return true;
  };
  const openThread = async (th: Thread, a?: ThreadVersion, b?: ThreadVersion) => {
    dropReviewUndo();
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
  /** 这一对（按内容）已经在哪份往来稿里，且原始在前 */
  const pairInThread = (shaA?: string, shaB?: string) => {
    if (!shaA || !shaB) return null;
    for (const th of live(libRef.current.threads)) {
      const va = th.versions.find((v) => v.file.sha === shaA), vb = th.versions.find((v) => v.file.sha === shaB);
      if (va && vb && th.versions.indexOf(va) < th.versions.indexOf(vb)) return { th, va, vb };
    }
    return null;
  };
  /** 库里的文件直接用；磁盘上的文件拷进库 */
  const libVersion = async (d: DocModel, n: number, side: LibSide, now: number): Promise<ThreadVersion> => {
    const inLib = !!(d.file as any).lib;
    return { id: uid(), n, side, added: now, file: inLib ? { sha: d.sha256!, ext: d.file.ext, size: d.file.size, name: d.file.name, mtime: d.file.mtime } : await putFile(d.file.path), fp: fingerprint(d), orig: inLib ? undefined : d.file.path };
  };
  /** 新建一份往来稿：原始 = V1（我方），修改后 = V2（对方） */
  const createThread = async (da: DocModel, db: DocModel, tplRef?: { tid: string; v: TplVersion }): Promise<Thread> => {
    const now = Date.now();
    const v1: ThreadVersion = tplRef
      ? { id: uid(), n: 1, side: 'ours', added: now, file: tplRef.v.file, fp: tplRef.v.fp, orig: tplRef.v.orig, tpl: { tid: tplRef.tid, vid: tplRef.v.id } }
      : await libVersion(da, 1, 'ours', now);
    const v2 = await libVersion(db, 2, 'theirs', now);
    const th: Thread = { id: uid(), name: cleanStem(db.file.name), created: now, updated: now, versions: [v1, v2], rounds: [], tpl: tplRef ? { tid: tplRef.tid, vid: tplRef.v.id } : undefined };
    await commitLib({ ...libRef.current, threads: [...libRef.current.threads, th] });
    return th;
  };
  /** 把当前的一对文件存成往来稿 */
  const saveAsThread = async (tplRef?: { tid: string; v: TplVersion }) => {
    if (!A || !B) return;
    // 这一对已经在某份往来稿里：直接进入，不重复建
    const hit = pairInThread(A.sha256, B.sha256);
    if (hit) { setThread({ id: hit.th.id, a: hit.va.id, b: hit.vb.id }); if (!tplRef) flash(t('这两份已经在往来稿「{n}」里了', { n: hit.th.name })); return; }
    try {
      const th = await createThread(A, B, tplRef);
      setThread({ id: th.id, a: th.versions[0].id, b: th.versions[1].id });
      if (!tplRef) flash(t('已存为往来稿「{n}」', { n: th.name }));
    } catch (e: any) { flash(t('没能存为往来稿：{e}', { e: String(e?.message || e) })); }
  };
  /** 1.9.1 F5：首页「最近比较」里存为往来稿——留在首页，后台读两份文件、建往来稿，不打开比较 */
  const [savingRecent, setSavingRecent] = useState<string | null>(null);
  // 1.9.1 F7：首页左卡片的页签。第一次默认“最近比较”，之后记住上次选的
  // 1.9.3（F14）：模板 / 往来稿演示弹窗
  const [demo, setDemo] = useState<DemoKind | null>(null);
  // 1.9.3（F12）：快捷键速查
  const [keysOpen, setKeysOpen] = useState(false);
  const [homeTab, setHomeTab] = useState<'recent' | 'threads'>(() => { try { return localStorage.getItem('docdiff.homeTab') === 'threads' ? 'threads' : 'recent'; } catch { return 'recent'; } });
  const pickHomeTab = (k: 'recent' | 'threads') => { setHomeTab(k); try { localStorage.setItem('docdiff.homeTab', k); } catch {} };
  const [showArch, setShowArch] = useState(false);
  const saveRecentAsThread = async (r: any) => {
    if (savingRecent) return;
    const known = pairInThread(r.a.sha, r.b.sha);
    if (known) { flash(t('这两份已经在往来稿「{n}」里了', { n: known.th.name })); return; }
    const key = r.a.path + '\n' + r.b.path;
    setSavingRecent(key);
    try {
      const ok = await Promise.all([api.exists(r.a.path), api.exists(r.b.path)]);
      if (!ok[0] || !ok[1]) { flash(t('没能存为往来稿：找不到「{f}」，它可能被移动或删除了', { f: !ok[0] ? r.a.name : r.b.name })); return; }
      const [fa, fb] = await Promise.all([api.readPath(r.a.path), api.readPath(r.b.path)]);
      const [da, db] = await Promise.all([loadDoc(fa), loadDoc(fb)]);
      const hit = pairInThread(da.sha256, db.sha256);
      if (hit) { flash(t('这两份已经在往来稿「{n}」里了', { n: hit.th.name })); return; }
      const th = await createThread(da, db);
      flash(t('已存为往来稿「{n}」', { n: th.name }));
    } catch (e: any) {
      flash(e instanceof NeedPassword ? t('没能存为往来稿：有密码的 PDF 要先打开这次比较，再存为往来稿') : t('没能存为往来稿：{e}', { e: String(e?.message || e) }));
    } finally { setSavingRecent(null); }
  };
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
  /** 1.9.1：删掉往来稿里的一版。后面的版本重新编号；正在比的一对用到它时回到最新两版；10 秒内可撤销 */
  const deleteThreadVersion = (th0: Thread, v: ThreadVersion) => {
    const snap = libRef.current.threads.find((x) => x.id === th0.id);
    if (!snap || snap.versions.length <= 2) return;
    const isLast = snap.versions[snap.versions.length - 1].id === v.id;
    const viewing = threadRef.current?.id === snap.id && (threadRef.current.a === v.id || threadRef.current.b === v.id);
    const back = viewing ? { ...threadRef.current! } : null;
    softDelete(
      (l) => ({ ...l, threads: l.threads.map((y) => (y.id === snap.id ? dropVersion(y, v.id) : y)) }),
      (l) => ({ ...l, threads: l.threads.map((y) => (y.id === snap.id ? snap : y)) }),
      isLast ? t('已删除 V{n}', { n: v.n }) : t('已删除 V{n}，后面的版本已重新编号', { n: v.n }), undefined, 'lib',
      () => { if (back && threadRef.current?.id === back.id) { const a = snap.versions.find((x) => x.id === back.a), b = snap.versions.find((x) => x.id === back.b); if (a && b) openThread(snap, a, b); } });
    if (viewing) openThread(dropVersion(snap, v.id));
  };
  const labelThreadVersion = (th: Thread, v: ThreadVersion, label: string) =>
    updThread(th.id, (x) => ({ ...x, versions: x.versions.map((y) => (y.id === v.id ? { ...y, label: label || undefined } : y)) }));
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
  const softDelete = (apply: (l: Library) => Library, restore: (l: Library) => Library, msg: string, obj?: string, scope = 'home', afterUndo?: () => void) => {
    commitLib(apply(libRef.current));
    undoTimer.current.clear();
    purgeTimer.current.clear();
    setUndoToast({ msg, obj, scope, undo: () => { undoTimer.current.clear(); setUndoToast(null); commitLib(restore(libRef.current)); flash(t('已撤销删除')); afterUndo?.(); } });
    undoTimer.current.set(() => setUndoToast(null), UNDO_MS);
    purgeTimer.current.set(() => {
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
  const opts: DiffOptions = { ignoreCase: prefs.ignoreCase, ignoreWhitespace: prefs.ignoreWs, precision: prefs.precision, formatting, detectMoves: prefs.detectMoves, normPunct: prefs.normPunct, normQuotes: prefs.normQuotes };
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
  /** 1.9.4：认回决定时核对所在条款；PDF 记下段落读法版本 */
  const decOpt = { clauses, pdf: A?.type === 'pdf' || B?.type === 'pdf' };
  const [pdfUpgrade, setPdfUpgrade] = useState<{ kept: number; lost: number; pk: string } | null>(null);
  // 全部认回时只是信息提示，停一会儿自动收起
  useEffect(() => { if (pdfUpgrade && !pdfUpgrade.lost) { const id = setTimeout(() => setPdfUpgrade(null), 3200); return () => clearTimeout(id); } }, [pdfUpgrade]);
  const risks: Risk[] = useMemo(() => (richRes ? detectRisks(richRes, clauses, { money: prefs.riskMoney, date: prefs.riskDate, keywords: prefs.keywords }) : []), [richRes, clauses, prefs.riskMoney, prefs.riskDate, prefs.keywords]);
  const riskById = useMemo(() => new Map(risks.map((r) => [r.cid, r])), [risks]);
  const scope = useMemo(() => (A && B ? scopeInfo(A, B, opts, richRes) : null), [A, B, optKey, richRes, lang]);
  const noClauses = useMemo(() => new Map<number, string | null>(), []);

  // ---------- 审阅决定：载入 / 保存 / 设置变化后的迁移 ----------
  const reviewer = prefs.reviewerName.trim() || t('审阅人');
  const pk = pairKey(A?.sha256, B?.sha256);

  // ---------- 1.9.5：文档里已有的批注 ----------
  const rowClause = useMemo(() => (richRes && RA && RB ? rowClauses(richRes, RA.blocks, RB.blocks) : []), [richRes, RA, RB]);
  // 每一对文件自己的批注状态：按 pk 同步读出（换文件时不会把上一对的回复带进这一对的审阅稿）
  const [cmVer, setCmVer] = useState(0);
  const cmSt = useMemo<CmState>(() => loadCm(pk), [pk, cmVer]);
  useEffect(() => { setCmOpen(null); }, [pk]);
  const updCm = (f: (st: CmState) => CmState) => { saveCm(pk, f(loadCm(pk))); setCmVer((v) => v + 1); };
  const ourMembers = prefs.ourMembers;
  const threads = useMemo<CmThread[]>(() => (richRes && RA && RB && (RA.comments?.length || RB.comments?.length)
    ? buildThreads(RA, RB, richRes, { ours: ourMembers, reviewer, overrides: cmSt.own, localReplies: cmSt.replies, rowClause }) : []),
  [richRes, RA, RB, ourMembers, reviewer, cmSt.own, cmSt.replies, rowClause]);
  const cmBy = useMemo(() => { const m = new Map<number, CmThread[]>(); for (const th of threads) for (const c of th.cids) (m.get(c) || m.set(c, []).get(c)!).push(th); return m; }, [threads]);
  const cmRich = useMemo(() => (threads.length && richRes ? cmView(richRes, threads, 'rich') : undefined), [threads, richRes]);
  const cmRed = useMemo(() => (threads.length && richRes ? cmView(richRes, threads, 'redline') : undefined), [threads, richRes]);
  const cmCount = useMemo(() => threads.filter(cmLive).length, [threads]);
  const ourSet = useMemo(() => new Set([...ourMembers, reviewer].map(normName)), [ourMembers, reviewer]);
  const isOurs = (n: string) => ourSet.has(normName(n));
  const internalList = useMemo(() => (RB && threads.length ? internalComments(RB, threads, { ours: ourMembers, reviewer, overrides: cmSt.own }) : []), [RB, threads, ourMembers, reviewer, cmSt.own]);
  const internalLeft = internalList.filter((x) => !cmSt.drop.includes(x.id));
  const unreplied = threads.filter((th) => th.side === 'b' && th.owner === 'theirs' && !th.resolved && !th.replied).length;
  /** 写进审阅稿的：对对方批注的回复、不带入的批注（不带入一条时，它的回复一起去掉） */
  const cmDraft = useMemo(() => {
    const replies = Object.entries(cmSt.replies).filter(([k, v]) => k.startsWith('b:') && v.text.trim() && threads.some((th) => th.key === k)).map(([k, v]) => ({ parent: k.slice(2), text: v.text.trim(), at: v.at }));
    const drop = new Set<string>();
    for (const id of cmSt.drop) { drop.add(id); const th = threads.find((x) => x.side === 'b' && x.root.id === id); th?.replies.forEach((r) => drop.add(r.id)); }
    return { replies, drop: [...drop].sort() };
  }, [cmSt.replies, cmSt.drop, threads]);
  const [cmOpen, setCmOpen] = useState<{ keys: string[]; n: number; reply?: boolean } | null>(null);
  const cmAnchor = useRef<HTMLElement | null>(null);
  const [cmJump, setCmJump] = useState<{ row: number; n: number } | null>(null);
  const [dropAsk, setDropAsk] = useState(false);
  const openCm = (keys: string[], el: HTMLElement, reply?: boolean) => {
    cmAnchor.current = el;
    setCmOpen((o) => ({ keys, n: (o?.n || 0) + 1, reply }));
    updCm((st) => { const add = keys.filter((k) => !st.seen.includes(k)); return add.length ? { ...st, seen: [...st.seen, ...add] } : st; });
  };
  const cmActs: CardActs = {
    reviewer,
    replyOf: (k) => cmSt.replies[k],
    onReply: (k, text) => updCm((st) => { const r = { ...st.replies }; if (text) r[k] = { text, at: Date.now() }; else delete r[k]; return { ...st, replies: r }; }),
    onOwner: (k, o) => updCm((st) => { const own = { ...st.own }; if (o) own[k] = o; else delete own[k]; return { ...st, own }; }),
    onAddMember: (name) => { setPrefs((p) => ({ ...p, ourMembers: [...p.ourMembers, name] })); flash(t('已把「{n}」加进我方成员', { n: name })); },
    onDrop: (id, on) => updCm((st) => ({ ...st, drop: on ? [...new Set([...st.drop, id])] : st.drop.filter((d) => d !== id) })),
    dropped: (id) => cmSt.drop.includes(id),
    isOurs,
  };
  /** 定稿会去掉的批注：对方稿里已有的（按作者归属）+ 我方写的回复 */
  const cmGone = useMemo(() => {
    let theirs = 0, ours = Object.keys(cmSt.replies).filter((k) => k.startsWith('b:')).length;
    for (const th of threads) if (th.side === 'b') { if (th.owner === 'ours') ours++; else theirs++; for (const r of th.replies) { if (isOurs(r.author)) ours++; else theirs++; } }
    return { theirs, ours };
  }, [threads, cmSt.replies, ourSet]);
  /** 比对报告 / 审阅记录存档里的批注：全部（含已解决、我方回复） */
  const reportComments = () => threads.map((th) => ({
    clause: th.clause, side: th.side, owner: th.owner, internal: th.internal, resolved: th.resolved, author: th.root.author, date: th.root.date, text: th.root.text, quote: th.root.quote || th.root.delText || '',
    replies: [...th.replies.map((r) => ({ author: r.author, text: r.text, ours: isOurs(r.author) })), ...(cmSt.replies[th.key] ? [{ author: reviewer, text: cmSt.replies[th.key].text, ours: true }] : [])],
  }));
  /** 检查器里点了一条批注：纸面滚到那里，打开卡片（有修订的同时选中那处修订） */
  const pickCm = (th: CmThread, el: HTMLElement) => {
    if (th.row === undefined) { openCm([th.key], el); return; }
    if (th.cids.length) setSelCid(th.cids[0]);
    setCmJump((j) => ({ row: th.row!, n: (j?.n || 0) + 1 }));
    setTimeout(() => {
      const pin = mainRef.current?.querySelector(`.cm-pin[data-cmk~="${th.key}"]`) as HTMLElement | null;
      openCm([th.key], pin || el);
    }, 420);
  };
  /** 画布里点了批注标 / 点线文字、检查器差异行尾的批注标 */
  const onCmClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest('[data-cmk]') as HTMLElement | null;
    if (!el || el.closest('.cm-pop') || !el.dataset.cmk) return;
    if (el.dataset.cmOnly) { e.stopPropagation(); e.preventDefault(); }
    const keys = el.dataset.cmk.split(' ').filter(Boolean);
    if (cmOpen && cmOpen.keys.join(' ') === keys.join(' ') && cmAnchor.current === el) { setCmOpen(null); return; }
    openCm(keys, el);
  };
  // 1.9.3（F13）：格式变化 ≥ 10 处、占一半以上时提示；其中 6 成以上是同一类整段字体 / 字号变化时说清是哪一类
  const [fmtQuiet, setFmtQuiet] = useState(0);
  const fmtNoHint = (k: string) => { try { const all: string[] = JSON.parse(localStorage.getItem('docdiff.fmtHintOff') || '[]'); if (!all.includes(k)) localStorage.setItem('docdiff.fmtHintOff', JSON.stringify([...all, k].slice(-200))); } catch {} setFmtQuiet((x) => x + 1); };
  const fmtHint = useMemo(() => {
    if (!richRes || !formatting || !pk) return null;
    try { if ((JSON.parse(localStorage.getItem('docdiff.fmtHintOff') || '[]') as string[]).includes(pk)) return null; } catch {}
    const all = richRes.changes, f = all.filter((c) => c.kind === 'fmt');
    if (f.length < 10 || f.length * 2 < all.length) return null;
    let font = 0, size = 0;
    for (const c of f) {
      const row = richRes.rows[c.row];
      const whole = row && row.kind === 'format' && row.cids.length === 1;
      const sig = c.desc && c.desc.k === 'fmt' ? c.desc.sig : '';
      if (whole && sig.includes('font:')) font++;
      if (whole && sig.includes('sz:')) size++;
    }
    const big = (x: number) => x >= f.length * 0.6;
    return { n: f.length, kind: big(font) && big(size) ? 'both' : big(font) ? 'font' : big(size) ? 'size' : 'any' } as const;
  }, [richRes, formatting, pk, fmtQuiet]);
  const pkRef = useRef(pk);
  pkRef.current = pk;
  // 换了文件（交换左右、换版本、换文档）：上一对文件的撤销提示作废
  useEffect(() => { dropReviewUndo(); }, [pk]);
  // 换了一对文件：上一对因为提示关掉的格式检测恢复（这一对重新判断）
  useEffect(() => { if (fmtOff && fmtOff.pk !== pk) { setFmtOff(null); if (A && B && A.type === B.type && A.type !== 'txt') setFormatting(true); } }, [pk]);
  const decFor = useRef<DiffResult | null>(null);
  /** 当前决定属于哪一对文件（1.9.2：往来稿摘要只写给决定所属的那一轮） */
  const decPk = useRef('');
  const lastLoaded = useRef<{ pk: string; snap: string; opts: any } | null>(null);
  const optSnap = { ignoreCase: prefs.ignoreCase, ignoreWs: prefs.ignoreWs, precision: prefs.precision, detectMoves: prefs.detectMoves, normPunct: prefs.normPunct, normQuotes: prefs.normQuotes, formatting };
  useEffect(() => {
    if (!richRes) return;
    const lo = loadDecisions(pk, richRes.changes, decOpt);
    let { map, lost } = lo;
    // 1.9.4：PDF 段落读法更新后第一次打开这对文件：对不上的明确提示一次（Figma G7）
    setPdfUpgrade(lo.upgrade ? { ...lo.upgrade, pk } : null);
    if (!Object.keys(map).length && carryFrom.current && carryFrom.current !== pk) {
      map = loadDecisions(carryFrom.current, richRes.changes, decOpt).map;
      if (Object.keys(map).length) flash(t('文件更新了，已带回上一版里还对得上的 {n} 个决定', { n: Object.values(map).filter((d) => d.v).length }));
    }
    carryFrom.current = '';
    decFor.current = richRes;
    decPk.current = pk;
    setDecisions(map);
    setDoneOpen(false);
    decideOrder.current = [];
    const snap = JSON.stringify(optSnap);
    const prev = lastLoaded.current;
    if (prev && prev.pk === pk && prev.snap !== snap && lost > 0) {
      const restoreTo = prev.opts;
      setLostBanner({ n: lost, restore: () => {
        setPrefs((p) => ({ ...p, ignoreCase: restoreTo.ignoreCase, ignoreWs: restoreTo.ignoreWs, precision: restoreTo.precision, detectMoves: restoreTo.detectMoves, normPunct: restoreTo.normPunct, normQuotes: restoreTo.normQuotes ?? true }));
        setFormatting(restoreTo.formatting);
        setLostBanner(null);
      } });
    } else setLostBanner(null);
    lastLoaded.current = { pk, snap, opts: optSnap };
  }, [richRes]);
  useEffect(() => { if (richRes && decFor.current === richRes) { saveDecisions(pk, richRes.changes, decisions, decOpt); draftSync?.update(decisions); } }, [decisions]);

  // ---------- 审阅稿（1.8）：修改后文档是 Word 时，决定自动写进它旁边的一份拷贝 ----------
  const [draftSync, setDraftSync] = useState<DraftSync | null>(null);
  const [draftState, setDraftState] = useState<DraftState>({ s: 'none', unwritten: [], prior: 0 });
  // 只在真的写好后提示（beta.7 · E5）；没写完的情况由状态片和完成页说明
  useEffect(() => { if (draftState.regenerated && draftState.s === 'saved' && !draftState.unwritten.length) flash(t('原来的审阅稿不见了，已按 DocDiff 里的决定在原位置重建。在 Word 里直接改的内容没有保留。')); }, [draftState.regenerated, draftState.s]);
  const doneRef = useRef(false);

  const heldN = richRes ? richRes.changes.filter((c) => decisions[c.id]?.v === 'h').length : 0;
  const allDecided = !!richRes && richRes.changes.length > 0 && richRes.changes.every((c) => decisions[c.id]?.v);
  // 刚审完一份回到首页：对对说一句“干得漂亮”（只在首页挂载时读一次）
  useEffect(() => { if (allDecided) doneRef.current = true; else if (compared) doneRef.current = false; }, [allDecided, compared]);
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
  // 生成审阅稿后第一次写好：盖一下章（1.9 · M10）
  useEffect(() => { if (draftState.fresh && draftState.s === 'saved') cheer('stamp'); }, [draftState.fresh, draftState.s]);
  const draftReady = draftState.s === 'saved' && !draftState.unwritten.length && !draftState.behind && !!draftState.path;
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
    sync.setComments(cmDraftRef.current);
    if (decFor.current === richRes) sync.update(decisions);
    return () => { off(); sync.dispose(); };
  }, [richRes, pk, draftArmed]);
  const cmDraftRef = useRef(cmDraft);
  cmDraftRef.current = cmDraft;
  useEffect(() => { draftSync?.setComments(cmDraft); }, [draftSync, cmDraft]);
  const draftVer = activeTh && thread ? activeTh.versions.find((v) => v.id === thread.b) : null;
  useEffect(() => { if (draftSync) { draftSync.ctx.ver = draftVer ? `V${draftVer.n}` : undefined; const renamed = draftSync.ctx.reviewer !== reviewer || draftSync.ctx.initials !== (prefs.reviewerInitials.trim() || initialsOf(reviewer)); draftSync.ctx.initials = prefs.reviewerInitials.trim() || initialsOf(reviewer); if (renamed) { draftSync.ctx.reviewer = reviewer; draftSync.touch(); } draftSync.ctx.reviewer = reviewer; draftSync.ctx.onMissing = prefs.draftMissing; draftSync.ctx.pattern = prefs.draftName.trim() || t('{name}-我方意见'); draftSync.ctx.theirs = prefs.authorName.trim() || B?.meta['最后修改者'] || B?.meta['作者'] || t('修改方'); } }, [draftSync, reviewer, prefs.reviewerInitials, prefs.draftName, prefs.authorName, prefs.draftMissing, draftVer]);
  // 往来稿：这一轮的结论摘要存进往来稿（只存有结论或备注的处），供下一轮的“上轮”提示和条款历史使用
  // 1.9.2：待写的摘要按“往来稿 + 这一对版本”各自记，换到别的版本对、离开往来稿或退出时立刻写掉，不再被新版本对取消；
  // 只在决定确实属于这一对版本时才写（换版本时新结果还没出来，不能把旧决定记到新的一轮上）。
  const pendingRound = useRef<{ key: string; run: () => Promise<void> | void; timer: any } | null>(null);
  const flushRound = () => { const p = pendingRound.current; if (!p) return Promise.resolve(); clearTimeout(p.timer); pendingRound.current = null; return Promise.resolve(p.run()); };
  useEffect(() => {
    const th0 = thread ? libRef.current.threads.find((x) => x.id === thread.id) : null;
    const va = th0?.versions.find((v) => v.id === thread!.a), vb = th0?.versions.find((v) => v.id === thread!.b);
    const mine = !!(thread && richRes && decFor.current === richRes && va && vb && decPk.current === pk && pairKey(va.file.sha, vb.file.sha) === pk);
    const key = mine ? `${thread!.id}|${thread!.a}|${thread!.b}` : '';
    if (pendingRound.current && pendingRound.current.key !== key) void flushRound();
    if (!mine) return;
    const th1 = thread!, res = richRes!, decs = decisions, cl = clauses, pk1 = pk;
    const run = () => {
      const items = res.changes.filter((c) => decs[c.id]?.v || decs[c.id]?.note)
        .map((c) => ({ clause: cl.get(c.id) ?? null, before: c.before.slice(0, 300), after: c.after.slice(0, 300), v: decs[c.id]?.v, note: decs[c.id]?.note }));
      const r: Round = { a: th1.a, b: th1.b, pk: pk1, total: res.changes.length, decided: res.changes.filter((c) => decs[c.id]?.v).length, updated: Date.now(), items };
      const th = libRef.current.threads.find((x) => x.id === th1.id);
      if (!th) return;
      const old = th.rounds.find((x) => x.a === r.a && x.b === r.b);
      if (old && old.decided === r.decided && JSON.stringify(old.items) === JSON.stringify(r.items)) return;
      return updThread(th.id, (x) => ({ ...x, updated: Date.now(), rounds: [...x.rounds.filter((y) => !(y.a === r.a && y.b === r.b)), r] }));
    };
    if (pendingRound.current) clearTimeout(pendingRound.current.timer);
    const entry = { key, run, timer: 0 as any };
    entry.timer = setTimeout(() => { if (pendingRound.current === entry) { pendingRound.current = null; void run(); } }, (window as any).__ddRoundDelay ?? 600); // 测试可以把等待拉长，卡住“摘要还没写”的时机
    pendingRound.current = entry;
  }, [decisions, thread, richRes]);
  // 审阅稿离开界面后在后台没能写完、或上次退出时没写完：明确告诉用户哪些决定还没写进去、怎么补
  const [behindDlg, setBehindDlg] = useState<{ mode: 'bg' | 'start' | 'quit'; items: DraftBehind[] } | null>(null);
  /** 1.9.4：启动时的提示里“以后启动时不再提示” */
  const [behindMute, setBehindMute] = useState(false);
  useEffect(() => {
    onDraftBackground((e) => setBehindDlg((d) => ({ mode: 'bg', items: [...(d && d.mode !== 'quit' ? d.items.filter((x) => x.pk !== e.pk) : []), e] })));
    const p = pendingDrafts();
    const items = Object.entries(p).filter(([, r]) => !r.muted).map(([pk, r]) => ({ pk, path: r.path, name: r.name, behind: r.behind, s: r.s }));
    if (items.length) setBehindDlg({ mode: 'start', items });
    return () => onDraftBackground(null);
  }, []);
  // 关窗 / 退出前（1.9.2）：先写掉往来稿摘要和审阅稿里剩下的决定；写不完时问用户
  useEffect(() => api.onCloseRequest?.(async () => {
    try { await flushRound(); } catch {}
    let left: DraftBehind[] = [];
    try { left = await flushDrafts(5000); } catch {}
    if (!left.length) { api.closeReply?.(true); return; }
    api.closeWait?.();
    setBehindDlg({ mode: 'quit', items: left });
  }), []);
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
  const shown: Change[] = useMemo(() => (filter === 'all' || filter === 'cm' ? changes : filter === 'risk' ? changes.filter((c) => riskById.has(c.id)) : changes.filter((c) => c.kind === filter)), [changes, filter, riskById]);
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
    dropReviewUndo();
    // 连按不掉速（1.9）：上一处的 220ms 跳转还没到就又按了，先立刻完成跳转，这一下作用到下一处
    const pj = pendingJump.current;
    if (pj) {
      clearTimeout(pj.t); pendingJump.current = null;
      if (v) { setSelCid(pj.to); if (cid === pj.from) cid = pj.to; }
    }
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
    if (!all && changes.length >= 6 && before * 2 < changes.length && after * 2 >= changes.length) {
      flash(t('过半了！还剩 {n} 处', { n: changes.length - after }));
      // 1.9：过半时对对也在检查器角落探头挥手（文字提示保留）
      rpeek.fire({ act: 'wave', line: t('过半啦，继续！') }, 'half');
    } else if (!all && changes.length >= 4 && after === changes.length - 1 && before < after) rpeek.fire({ act: 'jump', line: t('最后一处！') }, 'last');
    else rpeek.nudge();
    // 彩蛋：连续接受 / 拒绝 20 处不停（每两次间隔不超过 4 秒）→ 击掌
    const nowMs = Date.now();
    streak.current = (v === 'a' || v === 'r') && nowMs - streak.current.at < 4000 ? { n: streak.current.n + 1, at: nowMs } : { n: v === 'a' || v === 'r' ? 1 : 0, at: nowMs };
    if (streak.current.n === 20 && prefs.mascotWalk) { markSeen('egg:streak'); rpeek.fire({ act: 'clap', line: t('手感不错！') }, 'streak'); }
    if (all && changes.length) {
      setTimeout(() => { setDoneOpen(true); if (prefs.sound) chime('done'); }, 450);
    } else {
      const n = nextUndecided(cid, next);
      if (n) pendingJump.current = { t: setTimeout(() => { pendingJump.current = null; setSelCid(n.id); }, 220), from: cid, to: n.id };
    }
  };
  const pendingJump = useRef<{ t: any; from: number; to: number } | null>(null);
  const rpeek = useReviewPeek();
  const careCard = useCare(!compared || doneOpen, prefs.mascotWalk);
  const streak = useRef({ n: 0, at: 0 });
  const setNote = (cid: number, note: string) => {
    dropReviewUndo();
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
    const snap = { decisions, order: decideOrder.current.slice(), sel: selCid, pk };
    const next = { ...decisions };
    for (const { c, h } of reusable) next[c.id] = { ...mkDec(h.reuse, decisions[c.id]), note: decisions[c.id]?.note };
    setDecisions(next);
    setReuseAsk(false);
    undoTimer.current.clear();
    setUndoToast({ msg: t('已沿用上轮结论（{n} 处）', { n: reusable.length }), scope: pk, undo: () => { undoTimer.current.clear(); if (pkRef.current !== snap.pk) { setUndoToast(null); return; } decideOrder.current = snap.order; setDecisions(snap.decisions); setSelCid(snap.sel); setUndoToast(null); flash(t('已撤销，结论恢复到操作前')); } });
    undoTimer.current.set(() => setUndoToast(null), 10000);
  };
  const runBulk = (kind: 'a' | 'r' | 'reset') => {
    const snap = { decisions, order: decideOrder.current.slice(), sel: selCid, pk };
    const imp = bulkImpact(kind);
    decideAll(kind === 'reset' ? null : kind);
    setBulkAsk(null);
    undoTimer.current.clear();
    const msg = kind === 'reset' ? t('已清空 {n} 个结论', { n: imp.clear })
      : t(kind === 'a' ? '已全部接受（{n} 处）' : '已全部拒绝（{n} 处）', { n: imp.total });
    setUndoToast({
      msg,
      scope: pk,
      undo: () => {
        undoTimer.current.clear();
        if (pkRef.current !== snap.pk) { setUndoToast(null); return; }
        decideOrder.current = snap.order;
        setDecisions(snap.decisions);
        setSelCid(snap.sel);
        setDoneOpen(false);
        setUndoToast(null);
        flash(t('已撤销，结论恢复到操作前'));
      },
    });
    undoTimer.current.set(() => setUndoToast(null), 10000);
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
        const html = reportHtml({ A, B, res: richRes, clauses, risks, decisions, scope, reviewer, comments: reportComments() }, RA.blocks, RB.blocks);
        const p = await api.htmlToPdf({ html, defaultName: `${baseName}-${t('比对报告')}.pdf` });
        if (p) { flash(t('已导出：{p}', { p }), 'plane'); setExportOpen(false); }
      } else {
        const bytes = await buildDocx(richRes.rows, RA.blocks, RB.blocks, {
          mode: kind === 'final' ? 'final' : 'redline',
          author: expAuthor.trim() || t('修改方'),
          authorDate: new Date(B.file.mtime || Date.now()),
          reviewer: { name: reviewer, initials: prefs.reviewerInitials.trim() || initialsOf(reviewer) },
          decisions, commentAccepted: prefs.commentAccepted, risks: riskById, changes: richRes.changes, title: baseName,
          // 1.9.5：审阅记录存档保留全部批注（对方的、我方的、回复），每条线程写成一条批注
          docComments: kind === 'final' ? threads.map((th) => {
            const tag = t(th.internal ? '内部' : th.owner === 'ours' ? '我方' : '对方');
            const lines = [`[${tag}${th.resolved ? ' · ' + t('已解决') : ''}${th.side === 'a' ? ' · ' + t('我方稿') : ''}] ${th.root.text}`];
            for (const r of th.replies) lines.push(`↳ ${r.author}${colon()}${r.text}`);
            if (cmSt.replies[th.key]) lines.push(`↳ ${reviewer}${colon()}${cmSt.replies[th.key].text}`);
            return { row: th.row, author: th.root.author, initials: th.root.initials || '', date: th.root.date, lines };
          }) : undefined,
        });
        const p = await api.saveFile({ defaultName: `${baseName}-${t(kind === 'final' ? '审阅记录存档' : '修订稿')}.docx`, data: bytes, filters: [{ name: t('Word 文档'), extensions: ['docx'] }] });
        if (p) { flash(t('已导出：{p}', { p }), 'plane'); setExportOpen(false); }
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
    flash(t('已复制 {n} 处差异的摘要，可以直接粘贴', { n: curRes.changes.length }), 'clipboard');
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
  // 里程碑（1.9 · M12）：本机计数，每开始比较一对新文件 +1；第 10 / 100 / 1000 份时对对举奖杯
  const counted = useRef('');
  useEffect(() => {
    if (!compared || !pk || counted.current === pk) return;
    counted.current = pk;
    const n = countCompare();
    if (prefs.mascotWalk && (n === 10 || n === 100 || n === 1000)) { markSeen('egg:m' + n); flash(t(n === 10 ? '第 10 份了，越来越熟练啦。' : n === 100 ? '第 100 份！你比我还认真。' : '第 1000 份！向你致敬。'), 'trophy'); }
  }, [compared, pk]);
  // 切到深色模式：对对戴上墨镜（彩蛋）
  const themeSeen = useRef(theme);
  useEffect(() => {
    if (themeSeen.current !== theme && theme === 'dark' && prefs.mascotWalk) { markSeen('egg:sunglasses'); flash(t('天黑了，戴上墨镜。'), 'sunglasses'); }
    themeSeen.current = theme;
  }, [theme]);
  const startCompare = () => { if (canCompare) { setCompared(true); setTab(0); setChangedSides([]); } };
  const clearAll = () => { dropReviewUndo(); clearPageCaches(); setThread(null); setDocs([null, null]); setCompared(false); setErrs([null, null]); ocrRun.current++; setOcr({ status: 'idle' }); setChangedSides([]); setLostBanner(null); lastLoaded.current = null; };
  const swap = () => { dropReviewUndo(); setThread(null); setDocs(([a, b]) => [b, a]); ocrRun.current++; setOcr({ status: 'idle' }); };
  const actions = useRef<any>({});
  // 1.9.1 底部层级：首页有底栏，提示条要让开它
  useEffect(() => { document.documentElement.dataset.view = compared && A && B ? 'compare' : 'home'; }, [compared, !!A, !!B]);
  // 1.9.1 小彩蛋：两份一字不差时撒一小把彩纸（只在第一次，跟着彩纸开关）
  const [sameBurst, setSameBurst] = useState(0);
  useEffect(() => {
    if (!richRes || !prefs.celebrate || richRes.changes.length || !richRes.rows.length) return;
    try { if (localStorage.getItem('docdiff.sameConfetti')) return; localStorage.setItem('docdiff.sameConfetti', '1'); } catch { return; }
    setSameBurst(Date.now());
    const id = setTimeout(() => setSameBurst(0), 2600);
    return () => clearTimeout(id);
  }, [richRes]);
  const findable = compared && (tab === 0 || tab === 1 || tab === 2 || (tab === 4 && !!ocrRes));
  const openFind = () => { setFindOpen(true); setFindKey((k) => k + 1); };
  useEffect(() => { if (!findable) setFindOpen(false); }, [findable]);
  actions.current = { open, swap, clearAll, go, decide, setTab, startCompare, toggleNav, toggleAside, compared, tab, selCid, findable, openFind, openKeys: () => setKeysOpen(true), // 首页的撤销只在首页按 U 生效；审阅类的只对同一对文件生效（1.9 · QA P1）
    undoBulk: !undoToast ? undefined : undoToast.scope === 'lib' ? undoToast.undo : undoToast.scope === 'home' ? (!compared ? undoToast.undo : undefined) : undoToast.scope === pk ? undoToast.undo : undefined, modal: !!(pwd || pasteSide !== null || showSettings || exportOpen || pop || bulkAsk) };
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
    else if (cmd === 'find' && a.findable) a.openFind();
  }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = actions.current;
      const t = e.target as HTMLElement;
      // 1.9.1：Ctrl / ⌘ + F 打开查找（菜单栏也有同样的快捷键；两处都触发时只是再聚焦一次）
      if (modPressed(e) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f' && a.findable && !a.modal && !document.querySelector('.modal-bg')) { e.preventDefault(); a.openFind(); return; }
      if (e.defaultPrevented || a.modal || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable || modPressed(e) || e.altKey) return;
      // 任何弹窗开着、或焦点在弹出层里时，A/R/H/J/K/U 等都不作用到后台（beta.5：统一按界面判断，新加的弹窗不会漏掉）。
      // 审阅稿首次提示只是说明，不拦快捷键。
      if (document.querySelector('.modal-bg')) return;
      const inPop = t.closest?.('.pop');
      if (inPop && !inPop.classList.contains('draft-tip')) return;
      // 1.9.3（F12）：按 ? 打开快捷键速查（首页、比较页都能用；输入框里不触发）
      if (e.key === '?') { e.preventDefault(); a.openKeys(); return; }
      // 撤销提示在的时候按 U 撤销它：首页删除只在首页，批量决定只对同一对文件（见 undoBulk）
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
    lang, theme, paperFollowTheme: prefs.paperFollowTheme, sound: prefs.sound, celebrate: prefs.celebrate, mascotWalk: prefs.mascotWalk,
    reviewerName: prefs.reviewerName, reviewerInitials: prefs.reviewerInitials, authorName: prefs.authorName, commentAccepted: prefs.commentAccepted,
    draftName: prefs.draftName, finalName: prefs.finalName, draftMissing: prefs.draftMissing,
    riskMoney: prefs.riskMoney, riskDate: prefs.riskDate, keywords: prefs.keywords, autoCheckUpdate: prefs.autoCheckUpdate,
    ourMembers: prefs.ourMembers,
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
      {demo && <DemoDialog kind={demo} onClose={() => setDemo(null)} />}
      {keysOpen && <KeysModal onClose={() => setKeysOpen(false)} />}
      {pwd && <PasswordModal name={pwd.file.name} wrong={pwd.wrong} onCancel={() => setPwd(null)} onOk={(p) => { const x = pwd; setPwd(null); loadFile(x.side, x.file, p); }} />}
      {pasteSide !== null && <PasteModal side={pasteSide} onCancel={() => setPasteSide(null)} onOk={(t) => { const s = pasteSide; setPasteSide(null); loadFile(s, textFile(t, s)); }} />}
      {showSettings && <SettingsModal v={settingsValues} set={setSetting} onClose={() => setShowSettings(false)} initialTab={showSettings} sample={B?.type === 'docx' ? B.file.name : undefined} authors={authorsOf(A, B)}
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
      {behindDlg && (() => {
        const why = (x: DraftBehind) => x.s === 'locked' ? t('Word 正在使用这份审阅稿') : x.s === 'modified' ? t('审阅稿在 DocDiff 之外被改过，为了不覆盖已暂停') : x.s === 'gone' ? t('审阅稿被移走或删除了') : x.s === 'nowrite' ? t('文件夹写不进去') : x.s === 'error' ? t('写入出错{e}', { e: x.error ? colon() + x.error : '' }) : t('还没来得及写完');
        const quit = behindDlg.mode === 'quit';
        const close = () => { if (quit) api.closeReply?.(false); if (behindDlg.mode === 'start' && behindMute) mutePending(behindDlg.items.map((x) => x.pk)); setBehindMute(false); setBehindDlg(null); };
        return (
          <Modal title={quit ? t('还有决定没写进审阅稿') : behindDlg.mode === 'start' ? t('上次有决定没写进审阅稿') : t('有决定没写进审阅稿')} mood="think" onClose={close} className="behind-dlg"
            footer={quit ? <><button className="btn" onClick={() => { setBehindDlg(null); api.closeReply?.(true); }}>{t('仍然退出')}</button><button className="btn primary" onClick={close}>{t('先不退出')}</button></> : <>{behindDlg.mode === 'start' && <Checkbox className="behind-mute" checked={behindMute} onChange={setBehindMute}>{t('以后启动时不再提示')}</Checkbox>}<button className="btn primary" onClick={close}>{t('知道了')}</button></>}>
            <ul className="behind-list">
              {behindDlg.items.map((x) => (
                <li key={x.pk}><div className="file-row"><TypeTag type="docx" /><MidName name={x.name} /></div><p className="cap">{t('{n} 个决定没写进去', { n: x.behind })} · {why(x)}</p></li>
              ))}
            </ul>
            <p className="behind-main">{t('这些决定都保存在 DocDiff 里，不会丢。在这份审阅稿写好之前，不要把它发给对方。')}</p>
            <p className="bulk-note">{t('再打开这次比较时会自动补写；Word 正在用时，先在 Word 里关掉它。')}</p>
          </Modal>
        );
      })()}
      {/* 有撤销提示时，新的提示叠在它上面，不再被吞掉（beta.7：如“审阅稿已重建”） */}
      {moment && !toast && <div className="moment solo" key={moment.n} aria-hidden><Mascot size={44} act={moment.act} /></div>}
      {toast && <div className={`toast${undoToast ? ' above' : ''}`} role="status" aria-live="polite" onMouseEnter={() => toastTimer.current.pause()} onMouseLeave={() => toastTimer.current.resume(1200)}>{moment && <span className="moment" key={moment.n} aria-hidden><Mascot size={44} act={moment.act} /></span>}{toast}</div>}
      {undoToast && (
        <div className="toast undo" role="status" aria-live="polite"
          // 悬停或焦点在里面时暂停倒计时；首页删除的真正清除也一起暂停，否则停太久会撤销失败（1.9）
          onMouseEnter={() => { undoTimer.current.pause(); purgeTimer.current.pause(); }}
          onMouseLeave={(e) => { if (!e.currentTarget.contains(document.activeElement)) { undoTimer.current.resume(1500); purgeTimer.current.resume(1500); } }}
          onFocus={() => { undoTimer.current.pause(); purgeTimer.current.pause(); }}
          onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node) && !e.currentTarget.matches(':hover')) { undoTimer.current.resume(1500); purgeTimer.current.resume(1500); } }}>
          <span className="tm">{undoToast.msg}</span>
          {undoToast.obj && <span className="to" title={undoToast.obj}>「<MidName name={undoToast.obj} title={false} />」</span>}
          <button type="button" className="toast-btn" onClick={undoToast.undo}>{t('撤销')} <Kbd>U</Kbd></button>
          <button type="button" className="toast-x" aria-label={t('关闭')} onClick={() => { undoTimer.current.clear(); setUndoToast(null); }}><I.IconX /></button>
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
          <Modal title={title} mood="think" onClose={() => setBulkAsk(null)} className="bulk-ask"
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
      {/* 1.9.1：说明收进 ⓘ，只留一行状态 */}
      <p className="done-status">{t('结论已保存在 DocDiff 里')}<Info label={t('结论目前只记在 DocDiff 里')}>{t('结论目前只记在 DocDiff 里。要发给对方时，生成一份审阅稿：在对方文件旁边写好你的修订和批注，格式不变。')}</Info></p>
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
    const actThreads = live(lib.threads).filter((x) => !x.archived), archThreads = live(lib.threads).filter((x) => x.archived);
    const dropsEl = (
      <div className="drops compact">
        <DropZone side={0} compact doc={A} loading={busy[0]} error={errs[0]} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} onClear={() => setDocs((d) => [null, d[1]])} onPaste={() => setPasteSide(0)} />
        <div className="vs"><button className="btn plain icon vs-ic" title={`${t('交换左右')} · ${kbd('mod+shift+S')}`} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button></div>
        <DropZone side={1} compact doc={B} loading={busy[1]} error={errs[1]} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} onClear={() => setDocs((d) => [d[0], null])} onPaste={() => setPasteSide(1)} />
      </div>
    );
    const matchNotices = (
      <>
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
      </>
    );
    return (
      <MascotOn.Provider value={prefs.mascotWalk}>
      <div className={`app home fit${veteran ? '' : ' first'}${prefs.mascotWalk ? ' peek' : ''}`}>
        {/* 1.8.1：首页用 header / main / footer 三个区域，读屏和键盘导航能跳转 */}
        <header className="home-top drag">
          <Wordmark size={36} sub={t('离线文档比对')} />
          <div className="spacer" />
          <button className={`btn plain icon${updBadge ? ' has-dot' : ''}`} title={t(updBadge ? '设置（有新版本）' : '设置')} aria-label={t('设置')} onClick={() => setShowSettings('general')}><I.IconGear /></button>
        </header>
        <main className="home-scroll">
          <div className="home-inner">
            {/* 1.9.3（F9b / F11）：第一次用和用过之后同一套三块：新比较在上，下面两张卡片撑满到底栏，内容多了在卡片里滚动 */}
              <>
                <section className="mod-card mod-new" aria-labelledby="mod-new-h">
                  <div className="mod-h"><span className="mod-illo"><I.IlloNew /></span><h1 id="mod-new-h">{t('新比较')}</h1>{!veteran && <span className="mod-sub">{t('全部在这台电脑上完成，不会上传')}</span>}<span className="grow" />{!A && !B && <button className="btn sm" onClick={trySample}>{t('用示例合同试一下')}</button>}</div>
                  <div className="mod-b">{dropsEl}{matchNotices}</div>
                </section>
                <div className="lib-cols">
                  <section className="mod-card mod-lib" aria-label={t('最近比较和往来稿')}>
                    <div className="mod-h">
                      <span className="mod-illo"><I.IlloLib /></span>
                      <div className="mod-tabs" role="tablist" aria-label={t('最近比较和往来稿')}>
                        {([['recent', t('最近比较'), recent.length], ['threads', t('往来稿'), actThreads.length]] as const).map(([k, l, n]) => (
                          <button key={k} type="button" role="tab" id={'tab-' + k} aria-selected={homeTab === k} aria-controls="mod-lib-panel" className={homeTab === k ? 'on' : ''} onClick={() => pickHomeTab(k)}>
                            {l}{n > 0 && <span className="cnt">{n}</span>}
                          </button>
                        ))}
                      </div>
                      {actThreads.length > 0 && <button type="button" className="btn sm plain icon demo-btn" onClick={() => setDemo('lib')} title={t('看看往来稿怎么用（30 秒）')} aria-label={t('看看往来稿怎么用（30 秒）')}><I.IconPlay /></button>}
                      <span className="grow" />
                      {homeTab === 'recent' && recent.length > 0 && <button type="button" className="btn sm plain" onClick={async () => { await api.recentClear?.(); setRecent([]); }}>{t('清空')}</button>}
                      {homeTab === 'threads' && archThreads.length > 0 && <button type="button" className="btn sm plain" onClick={() => setShowArch(!showArch)}>{showArch ? t('返回') : t('已归档 {n}', { n: archThreads.length })}</button>}
                    </div>
                    <div className="mod-b" role="tabpanel" id="mod-lib-panel" aria-labelledby={'tab-' + homeTab}>
                      {homeTab === 'recent' ? (
                        recent.length === 0
                          ? <EmptyCard illo={<I.IlloNew size={72} />} title={t('比较过的文件会出现在这里')} desc={t('比较完可以存成往来稿，对方再发来新版本时接着比。')} demo={() => setDemo('lib')} demoLabel={t('看看往来稿怎么用（30 秒）')} />
                          : <div className="lib-rows">
                              {recent.map((r, i) => (
                                <RecentRow key={i} a={r.a} b={r.b} time={timeAgo(r.time)} prog={r.a.sha && r.b.sha ? reviewProgress(pairKey(r.a.sha, r.b.sha)) : null} thread={recentThread(r)}
                                  saving={savingRecent === r.a.path + '\n' + r.b.path}
                                  onOpen={() => openRecent(r)} onSave={() => saveRecentAsThread(r)} onRemove={() => api.recentRemove(i).then(setRecent)} />
                              ))}
                            </div>
                      ) : (
                        <ThreadsList threads={showArch ? archThreads : actThreads} archived={showArch} onOpen={(th) => openThread(th)} onRename={(th, name) => updThread(th.id, (x) => ({ ...x, name, updated: Date.now() }))}
                          onArchive={(th, on) => updThread(th.id, (x) => ({ ...x, archived: on ? Date.now() : undefined }))} onDelete={deleteThread} onDemo={() => setDemo('lib')} />
                      )}
                    </div>
                  </section>
                  <TemplatesCard lib={lib} threadCount={(tid) => live(lib.threads).filter((x) => x.tpl?.tid === tid).length} busy={libBusy} onUse={(tp) => setTplDlg(tp.id)} onNew={newTemplate} onAddVersion={addTplVersion}
                    onRename={renameTpl} onDelete={deleteTpl} onDeleteVersion={deleteTplVersion} onDemo={() => setDemo('tpl')} />
                </div>
              </>
          </div>
        </main>
        <footer className="home-cta">
          <HomePeek ready={!!canCompare} error={!!(errs[0] || errs[1])} justDone={doneRef.current} narrow={homeNarrow} quiet={!!(toast || undoToast)} />
          {canCompare
            ? <><span className="hint">{t('也可以直接按')} <Kbd>Enter</Kbd></span><button className="btn primary big" onClick={startCompare}>{t('开始比较')}</button></>
            : <><span className="hint">{busy[0] || busy[1] ? t('正在读取文档…') : t('还差 {n} 个文档', { n: missing })}</span><button className="btn primary big" disabled>{t('开始比较')}</button></>}
        </footer>
        {tplOpen && <TemplateCompareDialog tpl={tplOpen} B={B} bBusy={busy[1]} onPickB={() => open(1)} onDropB={(fs) => fs[0] && loadFile(1, fs[fs.length - 1])} onStart={startFromTemplate} onClose={() => setTplDlg(null)} />}
        {careCard}
        {modals}
      </div>
      </MascotOn.Provider>
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
    {prefs.imgMode === 'fade' && <span className="fade-ctl"><span className="cap">{t('原始')}</span><Slider value={fade} onChange={setFade} label={t('淡化程度')} valueText={t('淡化 {n}%', { n: fade })} width={140} /><span className="cap">{t('修改后')}</span></span>}
    <Select size="s" label={t('缩放')} title={t('缩放')} value={zoom} onChange={setZoom} minWidth={120}
      options={[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => ({ value: z, label: `${z * 100}%` }))} />
  </>);
  if (tab === 4) canvasTools = (<>
    {canvasTools}
    <Select size="s" label={t('识别语言')} value={prefs.ocrLang} onChange={(v) => set('ocrLang')(v as OcrLang)} disabled={ocr.status === 'running'}
      options={[{ value: 'chi_sim+eng', label: t('中文 + 英文') }, { value: 'chi_sim', label: t('仅中文') }, { value: 'eng', label: t('仅英文') }]} />
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
      <WaitMascot kind="compare" title={t('正在比较…')} />
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
  else if (tab === 0 && richRes && RA && RB) body = richRes.rows.length ? <RichView A={RA} B={RB} res={richRes} selCid={selCid} onSel={setSelCid} hideUnchanged={prefs.hideRich} cm={cmRich} cmOpen={cmOpen?.keys[0] ?? null} jumpTo={cmJump} />
    : <div className="empty-state"><Mascot mood="oops" size={96} /><h2>{t('没找到可以比较的文字')}</h2><div>{t((A.type === 'pdf' || B.type === 'pdf') ? '如果是扫描件，试试「OCR 文本」或「图像」模式。' : '两份文档好像都是空的。')}</div></div>;
  else if (tab === 1 && plainRes && plainBlocks) body = <PlainView A={plainBlocks[0]} B={plainBlocks[1]} res={plainRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} />;
  else if (tab === 2 && richRes && RA && RB) body = changes.length || threads.length ? <RedlineView A={RA} B={RB} res={richRes} selCid={selCid} onSel={setSelCid} decisions={decisions} innerRef={redlineRef} cm={cmRed} cmOpen={cmOpen?.keys[0] ?? null} jumpTo={cmJump} />
    : <div className="empty-state"><Mascot mood="cheer" size={96} act="jump" /><h2>{t(prefs.mascotWalk ? '一字不差' : '没有需要审阅的修订')}</h2>{sameText}</div>;
  else if (tab === 3 && needGate && counts) body = <PageRangeGate mode="image" pagesA={counts.a} pagesB={counts.b} initial={pageRanges[pairSha]} onConfirm={setPageRange} />;
  else if (tab === 3) body = <ImageView head={rangeHead} suspect={suspectPages} state={imgState} mode={prefs.imgMode} zoom={zoom} fade={fade} setFade={setFade} slider={slider} setSlider={setSlider} showBoxes={prefs.showBoxes} onlyDiff={onlyDiffPages} scrollRef={imgScroll} />;
  else if (tab === 4) {
    if (ocrRes && ocrBlocks) body = <PlainView A={ocrBlocks[0]} B={ocrBlocks[1]} res={ocrRes} selCid={selCid} onSel={setSelCid} layout={prefs.layout} wrap={prefs.wrap} hideUnchanged={prefs.hidePlain} lowWords={lowWords} />;
    else if (ocr.status !== 'running' && needGate && counts) body = <PageRangeGate mode="ocr" pagesA={counts.a} pagesB={counts.b} onConfirm={(r) => { setPageRange(r); runOcr(r); }} />;
    else if (ocr.status === 'running') body = <div className="empty-state"><WaitMascot kind="ocr" title={t('正在识别文字…')} />{rangeHead}<div>{ocr.msg}</div><div className="progress"><div style={{ width: `${ocr.pct || 0}%` }} /></div><button className="btn sm plain" onClick={cancelOcr}>{t('取消')}</button></div>;
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
  /** 1.9.5（H3）：这处修订上最相关的一条批注；审完最后一处时，还有多少条“没有修订的地方”的批注没打开过 */
  const curCm = cur && isRichTab ? bestFor(cmBy.get(cur.id) || []) : null;
  const restCm = cur && curIdx === changes.length - 1 ? threads.filter((th) => th.plain && cmLive(th) && !cmSt.seen.includes(th.key)).length : 0;

  // ---------- 比较设置（工具栏齿轮的弹出层） ----------
  const compareSettings = tab === 3 ? (
    <>
      <Opt label={t('标出差异区域')}><Switch on={prefs.showBoxes} onChange={set('showBoxes')} label={t('标出差异区域')} /></Opt>
      <Opt label={t('只看有差异的页')}><Switch on={onlyDiffPages} onChange={setOnlyDiffPages} label={t('只看有差异的页')} /></Opt>
      <Opt label={t('灵敏度')}>
        <Select size="s" label={t('灵敏度')} value={prefs.threshold} onChange={set('threshold')} minWidth={120}
          options={[{ value: 0.03, label: t('很高') }, { value: 0.1, label: t('标准') }, { value: 0.2, label: t('较低') }, { value: 0.35, label: t('低') }]} />
      </Opt>
    </>
  ) : (
    <>
      <Opt label={t('忽略空白差异')} hint={t('多余空格、换行符不同')}><Switch on={prefs.ignoreWs} onChange={set('ignoreWs')} label={t('忽略空白差异')} /></Opt>
      <Opt label={t('忽略全角 / 半角标点')} hint={t('，和 ,　（和 (　视为相同')}><Switch on={prefs.normPunct} onChange={set('normPunct')} label={t('忽略全角 / 半角标点')} /></Opt>
      <Opt label={t('忽略引号样式（直引号 / 弯引号）')} hint={t('\' 和 ’、" 和 ” 视为相同，词中间的撇号也算')}><Switch on={prefs.normQuotes} onChange={set('normQuotes')} label={t('忽略引号样式（直引号 / 弯引号）')} /></Opt>
      <Opt label={t('忽略大小写')}><Switch on={prefs.ignoreCase} onChange={set('ignoreCase')} label={t('忽略大小写')} /></Opt>
      <Opt label={t('检测移动的段落')}><Switch on={prefs.detectMoves} onChange={set('detectMoves')} label={t('检测移动的段落')} /></Opt>
      {isRichTab && <Opt label={t('检测格式变化')} hint={t(A.type !== B.type ? 'Word 与 PDF 互比时默认关闭' : '加粗、字号、颜色、标题级别')}><Switch on={formatting} onChange={(v) => { setFormatting(v); if (v) { fmtNoHint(pk); setFmtOff(null); } }} label={t('检测格式变化')} /></Opt>}
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
        {(changes.length > 0 || (isRichTab && cmCount > 0)) && stats && <FilterChips stats={stats} risks={isRichTab ? risks.length : 0} comments={isRichTab ? cmCount : 0} value={filter} onChange={setFilter} />}
        {isRichTab && fmtHint && (
          <div className="fmt-hint" role="status">
            <Notice tone="info" title={fmtHint.kind === 'font' ? t('{n} 处是格式变化，多数是整段字体不同', { n: fmtHint.n }) : fmtHint.kind === 'size' ? t('{n} 处是格式变化，多数是整段字号不同', { n: fmtHint.n }) : fmtHint.kind === 'both' ? t('{n} 处是格式变化，多数是整段字体、字号不同', { n: fmtHint.n }) : t('{n} 处是格式变化', { n: fmtHint.n })}>
              {t('两份文件可能一份是另存或转换出来的，文字修改容易被淹没。')}
            </Notice>
            <button type="button" className="btn sm blue" onClick={() => { setFmtOff({ pk, n: fmtHint.n }); setFormatting(false); }}>{t('只看文字修改')}</button>
          </div>
        )}
        {isRichTab && fmtOff && fmtOff.pk === pk && !formatting && (
          <div className="fmt-off" role="status"><span>{t('已隐藏 {n} 处格式变化', { n: fmtOff.n })}</span><button type="button" className="link-btn" onClick={() => { setFormatting(true); fmtNoHint(pk); setFmtOff(null); }}>{t('恢复')}</button></div>
        )}
        {isRichTab && filter === 'cm' ? (
          <CommentList key={lang} threads={threads} sel={cmOpen?.keys[0] ?? null} onSel={pickCm} acts={cmActs} />
        ) : changes.length > 0 ? (
          <ChangeList key={lang} changes={shown} all={changes} sel={selCid} onSel={setSelCid} onHover={hoverCid} decisions={tab === 2 ? decisions : undefined}
            clauses={isRichTab ? clauses : noClauses} risks={isRichTab ? riskById : new Map()} grouped={isRichTab} cmBy={isRichTab ? cmBy : undefined} />
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
        {tab === 2 && !narrow && <div className="rp-anchor"><ReviewPeek cue={rpeek.cue} /></div>}
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

  // 1.9.5（H5 ②）：审阅稿里混着我方内部批注
  const internalNotice = (cls?: string) => (
    <Notice tone="warn" className={cls} title={t('审阅稿里有 {n} 条我方内部批注。', { n: internalLeft.length })}
      action={<><button type="button" className="btn sm" onClick={() => setDropAsk(true)}>{t('不带入…')}</button><button type="button" className="btn sm" onClick={() => updCm((st) => ({ ...st, keep: true }))}>{t('保留')}</button></>}>
      {t('这份要发给对方，这 {n} 条会一起发出去。', { n: internalLeft.length })}
    </Notice>
  );
  const crossFormat = A.type !== B.type && (A.type === 'pdf' || B.type === 'pdf') && isRichTab && dismissCross !== docSig;
  const askReviewer = tab === 2 && changes.length > 0 && !prefs.reviewerAsked;
  // 1.9.3（F12）：有快捷键的按钮，悬停提示统一写成「名称 · 快捷键」
  const toggleTitle = (open: boolean, what: string, key: string) => `${t(open ? '收起{w}' : '展开{w}', { w: t(what) })} · ${key}`;
  const navKey = isMac ? '⌃⌘S' : 'Ctrl+Alt+S', inspKey = isMac ? '⌥⌘I' : 'Ctrl+Alt+I';

  return (
    <MascotOn.Provider value={prefs.mascotWalk}>
    <div onClickCapture={onCmClick} className={`app shell ${navOpen ? '' : 'nav-mini'} ${hasInsp && inspOpen && !narrow ? '' : 'insp-off'} ${narrow ? 'narrow' : ''}`}>
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
              <button key={i} type="button" className={`nav-item ${tab === i ? 'on' : ''}`} onClick={() => setTab(i)} title={`${t(m.label)} · ${kbd(`mod+${i + 1}`)}${n ? '\n' + n[1] : ''}`} aria-current={tab === i ? 'page' : undefined}>
                <span className={`mi mc-${m.c}`} aria-hidden="true">{m.g}</span><span className="lbl">{t(m.label)}</span>{n !== undefined && <span className="count">{n[0]}</span>}
              </button>
            );
          })}
        </div>
        <div className="spacer" />
        <div className="nav-foot">
          <button type="button" className="nav-item" onClick={clearAll} title={`${t('新建比较')} · ${kbd('mod+N')}`}><span className="fi" aria-hidden="true"><I.IconPlusDoc /></span><span className="lbl">{t('新建比较')}</span></button>
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
            onRename={(name) => updThread(activeTh.id, (x) => ({ ...x, name, updated: Date.now() }))}
            onLabel={(v, label) => labelThreadVersion(activeTh, v, label)} onDeleteVersion={(v) => deleteThreadVersion(activeTh, v)} />
        ) : (<>
        <FilePill side={0} doc={A} onOpen={() => open(0)} onFiles={(f) => onFiles(0, f)} changed={changedSides.includes(0)} onSave={A.file.path && B.file.path ? () => saveAsThread() : undefined} />
        <button type="button" className="ibtn" title={`${t('交换左右')} · ${kbd('mod+shift+S')}`} aria-label={t('交换左右')} onClick={swap}><I.IconSwap /></button>
        <FilePill side={1} doc={B} onOpen={() => open(1)} onFiles={(f) => onFiles(1, f)} changed={changedSides.includes(1)} onSave={A.file.path && B.file.path ? () => saveAsThread() : undefined} />
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
              <button type="button" className="ibtn" onClick={() => go(-1)} title={`${t('上一处')} · K`} aria-label={t('上一处')}><I.IconUp /></button>
              <span className="tb-pos">{shownIdx < 0 ? t('共 {n} 处', { n: shown.length }) : t('第 {i} / {n} 处', { i: shownIdx + 1, n: shown.length })}</span>
              <button type="button" className="ibtn" onClick={() => go(1)} title={`${t('下一处')} · J`} aria-label={t('下一处')}><I.IconDown /></button>
            </>
          ) : null}
        </div>
        {tab !== 5 && <button ref={gearRef} type="button" className="ibtn" onClick={() => setPop(pop === 'settings' ? null : 'settings')} title={t('比较设置')} aria-label={t('比较设置')} aria-expanded={pop === 'settings'}><I.IconGear /></button>}
        {curRes && <button type="button" className="btn tb-copy" onClick={copySummary} title={t('复制为 Markdown，可粘贴到邮件 / 飞书 / 文档')} aria-label={t('复制摘要')}><I.IconCopy /><span className="lbl">{t('复制摘要')}</span></button>}
        {richRes && tab === 2 && draftSync && B && (
          <DraftChip state={draftState} sync={draftSync} bPath={B.file.path} narrow={false} finalReq={finalReq} hideTip={tab === 2 && doneOpen} origLabel={origLabel} decided={richRes.changes.filter((c) => decisions[c.id]?.v).length}
            pending={richRes.changes.filter((c) => !decisions[c.id]?.v || decisions[c.id]?.v === 'h').length} held={heldN} onFinal={(p) => { setFinalMade(p); cheer('gradcap'); if (allDecided) setDoneOpen(true); return allDecided; }} finalPattern={prefs.finalName.trim() || t('{name}-定稿')}
            onJump={(cid) => { setTab(2); setFilter('all'); setSelCid(cid); }} flash={flash} cmGone={cmGone} />
        )}
        {richRes && isRichTab && <button type="button" className={`btn tb-export ${tab === 2 ? '' : 'primary'}`} onClick={openExport} title={t('导出')} aria-label={t('导出')}><I.IconExport /><span className="lbl">{t('导出')}</span></button>}
        {hasInsp && <button type="button" className="ibtn" onClick={toggleAside} title={toggleTitle(inspOpen, '检查器', inspKey)} aria-label={t(inspOpen ? '收起检查器' : '展开检查器')} aria-expanded={inspOpen}><I.IconPanelRight /></button>}
      </header>

      <main className="center">
        <h1 className="sr-only">{t('比较结果：{a} → {b}', { a: A?.file.name || '', b: B?.file.name || '' })}</h1>
        <div className="ch">
          <span className="t">{canvasTitle}</span>
          <span className="grow" />
          {canvasTools}
        </div>
        {changedSides.length > 0 && (
          <Notice className="bar" title={t('「{f}」刚刚在磁盘上被修改了', { f: changedSides.map((s) => docs[s]?.file.name).join('」/「') })}
            action={<button className="btn sm" onClick={reloadChanged}>{t('重新比较')}</button>} onClose={() => setChangedSides([])} closeLabel={t('忽略')} />
        )}
        {pdfUpgrade && pdfUpgrade.pk === pk && (pdfUpgrade.lost > 0
          ? <Notice tone="warn" className="bar" title={t('这份 PDF 的段落读法更新了，上次的 {n} 个决定对不上。', { n: pdfUpgrade.lost })}
              action={<button className="btn sm" onClick={() => setPdfUpgrade(null)}>{t('知道了')}</button>}>
              {pdfUpgrade.kept > 0 ? t('对得上的 {n} 个已经带回。对不上的不会挪到别的条款，这几处请重新看一下。', { n: pdfUpgrade.kept }) : t('对不上的不会挪到别的条款，这几处请重新看一下。')}
            </Notice>
          : <Notice tone="info" className="bar" title={t('这份 PDF 的段落读法更新了，上次的 {n} 个决定都已带回。', { n: pdfUpgrade.kept })} />)}
        {tab === 2 && draftSync && draftState.s !== 'none' && internalLeft.length > 0 && !cmSt.keep && !doneOpen && internalNotice('bar cm-int')}
        {tab === 2 && richRes && !changes.length && threads.length > 0 && (
          <Notice tone="info" className="bar cm-only" title={t('两份文件的文字一样，只有 {n} 条批注。', { n: threads.length })}>
            {t('没有需要审阅的修订。纸边的批注标和点线标出了批注的位置，点开可以查看和回复。')}
            {threads.length > cmCount ? ' ' + t('其中 {n} 条对方已解决，在「批注」里收起。', { n: threads.length - cmCount }) : ''}
          </Notice>
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
            action={<button className="btn sm" onClick={() => { if (richRes && decFor.current === richRes) saveDecisions(pk, richRes.changes, decisions, decOpt); }}>{t('重试保存')}</button>}>
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
        <div className="main" ref={mainRef}>
          {/* 1.8.1：切换语言时让画布重新挂载，区段标题、计数等应用文案跟着切（文档原文不变） */}
          <FindAll.Provider value={findOpen && findable}><React.Fragment key={lang}>{body}</React.Fragment></FindAll.Provider>
          {sameBurst > 0 && <Confetti key={sameBurst} n={30} />}
          {findOpen && findable && <FindBar rootRef={mainRef} focusKey={findKey} onClose={() => setFindOpen(false)} dep={[tab, curRes, prefs.hideRich, prefs.hidePlain, prefs.layout, decisions]} />}
          {showMap && <ChangeMap changes={changes} filter={filter === 'all' || filter === 'risk' || filter === 'cm' ? [] : [filter]} selCid={selCid} onSel={setSelCid} dep={[curRes, tab, prefs.hideRich, prefs.hidePlain, prefs.layout, prefs.wrap, decisions, inspOpen, navOpen, askReviewer]} />}
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
                <TextInput size="s" className="grow" autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} aria-label={t('审阅人姓名')}
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
              {cur && activeTh && hints.get(cur.id) && !curCm && <HintLine hint={hints.get(cur.id)!} th={activeTh} onReuse={(v) => decide(cur.id, v)} />}
              <label className="rb-note">
                <input id="note-input" ref={noteRef} disabled={!cur} value={cur ? decisions[cur.id]?.note || '' : ''} placeholder={t('备注（可选），会写进 Word 批注')}
                  onChange={(e) => cur && setNote(cur.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} aria-label={t('备注')} />
                <Kbd>N</Kbd>
              </label>
            </div>
            <div className="rb-acts">
              <button className="chip as-btn" onClick={() => setShowSettings('review')} title={t('审阅人：{n}（点击修改）', { n: reviewer })}><span className="av">{(prefs.reviewerInitials || initialsOf(reviewer)).slice(0, 2)}</span>{reviewer}</button>
              <button className="btn red" disabled={!cur} onClick={() => decide(selCid, 'r')} title={`${t('拒绝')} · R`}>{t('拒绝')}<Kbd>R</Kbd></button>
              <button className="btn hold" disabled={!cur} onClick={() => decide(selCid, 'h')} title={`${isEn() ? 'Keep open' : t('待议')} · H`}>{isEn() ? 'Keep open' : t('待议')}<Kbd>H</Kbd></button>
              <button className="btn primary" disabled={!cur} onClick={() => decide(selCid, 'a')} title={`${t('接受')} · A`}>{t('接受')}<Kbd>A</Kbd></button>
            </div>
            {(curCm || restCm > 0) && (
              <CommentHint th={curCm} more={(cur ? cmBy.get(cur.id)?.length || 1 : 1) - 1} rest={curCm ? 0 : restCm}
                onOpen={(el) => curCm && openCm((cmBy.get(cur!.id) || [curCm]).map((x) => x.key), el)} onReply={(el) => curCm && openCm([curCm.key], el, true)}
                onRest={() => { setFilter('cm'); if (!inspOpen) toggleAside(); }} />
            )}
          </div>
        )}
        {tab === 2 && doneOpen && (
          <div className="overlay-bg">
            {prefs.celebrate && !finalMade && <Confetti />}
            <div className="done-card" role="dialog" aria-label={t('审阅完成')}>
              {/* 1.9 · M5：两种欢呼随机一种（戴派对帽跳一下 / 转一圈）；有待议时换“思考 + 放大镜” */}
              {heldN > 0 ? <Mascot mood="cheer" size={120} className="mascot-pop" pose={{ mood: 'think', props: ['magnifier'], arms: 'hold' }} />
                : <Mascot mood="cheer" size={120} className="mascot-pop" act={doneFlavor ? 'spin' : 'jump'} pose={doneFlavor ? undefined : { props: ['party'] }} />}
              <h2>{t('全部看完了！')}</h2>
              {/* 待议算看完，但不等于谈定（beta.7） */}
              <div className="muted">{heldN > 0 ? t('已看完 {n} 处修订，{h} 处待议', { n: changes.length, h: heldN }) : t('{n} 处修订全部处理完毕', { n: changes.length })}</div>
              <div className="done-stats">
                {(['a', 'r', 'h'] as Verdict[]).map((v) => <div key={v} className={`done-stat ${v}`}><div className="h">{t(v === 'a' ? '接受' : v === 'r' ? '拒绝' : '待议')}</div><div className="v">{changes.filter((c) => decisions[c.id]?.v === v).length}</div></div>)}
              </div>
              {(unreplied > 0 || (draftSync && internalLeft.length > 0 && !cmSt.keep)) && (
                <div className="done-cm">
                  {unreplied > 0 && (
                    <Notice tone="info" title={t('对方有 {n} 条批注还没回复。', { n: unreplied })}
                      action={<button type="button" className="btn sm" onClick={() => { setDoneOpen(false); setFilter('cm'); if (!inspOpen) toggleAside(); }}>{t('去看看')}</button>}>
                      {t('不影响审阅稿。回复会作为批注的回复写进审阅稿，看一眼再发也来得及。')}
                    </Notice>
                  )}
                  {draftSync && internalLeft.length > 0 && !cmSt.keep && internalNotice()}
                </div>
              )}
              {doneActs}
            </div>
          </div>
        )}
      </main>

      {hasInsp && inspOpen && <aside className={`insp ${narrow ? 'drawer' : ''}`} aria-label={t('检查器')}>{insp}</aside>}
      {hasInsp && inspOpen && narrow && <div className="drawer-scrim" onClick={() => setDrawer(false)} />}

      <Popover anchor={gearRef} open={pop === 'settings'} onClose={closePop} title={t('比较设置')}>{compareSettings}</Popover>
      <Popover anchor={scopeRef} open={pop === 'scope'} onClose={closePop} title={t('比较范围')} width={360} align="end">{scope && <ScopeBody scope={scope} />}</Popover>
      <Popover anchor={moreRef} open={pop === 'more'} onClose={closePop} width={260} className="pop-menu" label={t('更多')}>
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
      {cmOpen && <CommentPop key={cmOpen.n} anchor={cmAnchor} threads={cmOpen.keys.map((k) => threads.find((x) => x.key === k)).filter(Boolean) as CmThread[]} acts={cmActs} onClose={() => setCmOpen(null)} autoReply={cmOpen.reply} />}
      {dropAsk && <DropInternalModal items={internalLeft} onClose={() => setDropAsk(false)} onOk={(ids) => { setDropAsk(false); updCm((st) => ({ ...st, drop: [...new Set([...st.drop, ...ids])] })); flash(t('生成审阅稿时不带入这 {n} 条', { n: ids.length })); }} />}
      {careCard}
      {modals}
    </div>
    </MascotOn.Provider>
  );
}
