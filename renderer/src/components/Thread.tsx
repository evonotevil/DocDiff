import React, { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Popover, MenuItem } from './Popover';
import { Modal } from './Modal';
import { Notice } from './Panel';
import { Seg } from './ui';
import { useDrop } from '../lib/drop';
import type { FileInfo } from '../lib/model';
import type { Thread, ThreadVersion, Side, Template } from '../lib/library';
import type { Hint } from '../lib/hints';
import type { RoundItem, Round } from '../lib/library';
import type { Verdict } from '../lib/review';

const md = (ms: number) => { const d = new Date(ms); return t('{m}月{d}日', { m: d.getMonth() + 1, d: d.getDate() }); };
const sideLabel = (s: Side) => (s === 'ours' ? t('我方') : t('对方'));
const VERB: Record<Verdict, string> = { a: '接受', r: '拒绝', h: '待议' };
const cut = (s: string, n = 24) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 首页「往来稿」栏 */
export function ThreadsCard({ threads, onOpen, onRename, onArchive, onDelete, children }: {
  threads: Thread[]; onOpen: (th: Thread) => void; onRename: (th: Thread, name: string) => void;
  onArchive: (th: Thread, on: boolean) => void; onDelete: (th: Thread) => void; children?: React.ReactNode;
}) {
  const [showArch, setShowArch] = useState(false);
  const act = threads.filter((x) => !x.archived), arch = threads.filter((x) => x.archived);
  const list = showArch ? arch : act;
  return (
    <section className="lib-card" aria-label={t('往来稿')}>
      <h2>{t('往来稿')}{act.length > 0 && <span className="cnt">{act.length}</span>}<span className="grow" />
        {arch.length > 0 && <button type="button" className="btn sm plain" onClick={() => setShowArch(!showArch)}>{showArch ? t('返回') : t('已归档 {n}', { n: arch.length })}</button>}
      </h2>
      {list.length === 0 && !showArch
        ? <p className="lib-empty">{t('一份合同来回改好几轮时，存成往来稿：每一版都留着，下次只放对方的新稿，默认和上一版比，上一轮的结论也会提示你。')}</p>
        : <div className="lib-rows">{list.map((th) => <ThreadRow key={th.id} th={th} onOpen={onOpen} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />)}</div>}
      {children}
    </section>
  );
}

function ThreadRow({ th, onOpen, onRename, onArchive, onDelete }: { th: Thread; onOpen: (th: Thread) => void; onRename: (th: Thread, n: string) => void; onArchive: (th: Thread, on: boolean) => void; onDelete: (th: Thread) => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const last = th.versions[th.versions.length - 1];
  const r = th.rounds.find((x) => x.b === last?.id);
  const prog = r ? (r.decided >= r.total ? t('已审完') : t('待审 {n} 处', { n: r.total - r.decided })) : '';
  const meta = [last ? `V${last.n}` : '', prog, last ? md(last.added) : ''].filter(Boolean).join(' · ');
  return (
    <div className="lib-row" role="button" tabIndex={0} onClick={() => edit === null && onOpen(th)} onKeyDown={(e) => { if (edit === null && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(th); } }}>
      <I.FileGlyph type={last?.file.ext || 'docx'} size={22} />
      {edit !== null
        ? <input className="lib-edit" autoFocus value={edit} onClick={(e) => e.stopPropagation()} onChange={(e) => setEdit(e.target.value)} aria-label={t('往来稿名称')}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && edit.trim()) { onRename(th, edit.trim()); setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
            onBlur={() => { if (edit.trim() && edit.trim() !== th.name) onRename(th, edit.trim()); setEdit(null); }} />
        : <span className="nm" title={th.name}>{th.name}</span>}
      <span className="meta">{meta}</span>
      <button ref={more} type="button" className="btn sm plain icon" aria-label={t('更多')} title={t('更多')} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><I.IconMore /></button>
      <Popover anchor={more} open={menu} onClose={() => setMenu(false)} width={260} title={th.name}>
        <div onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<I.IconEdit />} onClick={() => { setMenu(false); setEdit(th.name); }}>{t('重命名')}</MenuItem>
          <MenuItem icon={<I.IconCheck />} onClick={() => { setMenu(false); onArchive(th, !th.archived); }}>{th.archived ? t('取消归档') : t('归档（签完了）')}</MenuItem>
          <MenuItem icon={<I.IconX />} tone="danger" onClick={() => { setMenu(false); onDelete(th); }}>{t('删除往来稿')}</MenuItem>
        </div>
      </Popover>
    </div>
  );
}

/** 往来稿里的工具栏：合同名 + 正在比的两版，点开是版本链（代替两个文件片） */
export function VersionChip({ th, a, b, tpl, progress, onPick, onAdd, onRename }: {
  th: Thread; a: string; b: string; tpl?: Template | null;
  progress: (v: ThreadVersion) => string;
  onPick: (a: ThreadVersion, b: ThreadVersion) => void; onAdd: () => void; onRename: (n: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const va = th.versions.find((v) => v.id === a), vb = th.versions.find((v) => v.id === b);
  const tv = tpl && th.tpl ? tpl.versions.find((v) => v.id === th.tpl!.vid) : null;
  return (
    <>
      <button ref={ref} type="button" className="btn ver-chip" onClick={() => setOpen(!open)} aria-expanded={open} title={th.name}>
        <span className="nm">{th.name}</span>
        <span className="vv">{va ? `V${va.n}` : '?'} → {vb ? `V${vb.n}` : '?'}</span>
        <I.IconDown />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={360} align="start"
        title={edit !== null
          ? <input className="lib-edit" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={t('往来稿名称')}
              onKeyDown={(e) => { if (e.key === 'Enter' && edit.trim()) { onRename(edit.trim()); setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
              onBlur={() => { if (edit.trim()) onRename(edit.trim()); setEdit(null); }} />
          : <button type="button" className="ver-title" onClick={() => setEdit(th.name)} title={t('重命名')}>{th.name}<I.IconEdit /></button>}>
        <div className="ver-pop">
          {tpl && tv && <p className="cap">{t('基于模板：{n} {v}', { n: tpl.name, v: tv.label })}</p>}
          <div className="ver-list">
            {th.versions.map((v, i) => {
              const cur = v.id === b;
              return (
                <button key={v.id} type="button" className={`ver-row ${cur ? 'on' : ''} ${v.id === a ? 'base' : ''}`} disabled={i === 0}
                  title={i === 0 ? t('第一版') : t('和上一版（V{n}）比较', { n: th.versions[i - 1].n })}
                  onClick={() => { if (i > 0) { setOpen(false); onPick(th.versions[i - 1], v); } }}>
                  <span className={`vn ${v.side}`}>V{v.n}</span>
                  <span className="sd">{sideLabel(v.side)}</span>
                  <span className="fn">{v.file.name}</span>
                  <span className="pg">{i > 0 ? progress(v) : md(v.added)}</span>
                </button>
              );
            })}
          </div>
          <p className="cap">{t('点一版就和它的上一版比较。')}</p>
          <div className="acts"><button type="button" className="btn sm" onClick={() => { setOpen(false); onAdd(); }}><I.IconUpload />{t('加入新版本…')}</button></div>
        </div>
      </Popover>
    </>
  );
}

/** 加入新版本：放文件、是谁的、和哪一版比（设计稿 05） */
export function AddVersionDialog({ th, onPick, onDropFiles, file, busy, onDone, onClose }: {
  th: Thread; file: { name: string; ext?: string } | null; busy: boolean; onPick: () => void; onDropFiles: (f: FileInfo[]) => void;
  onDone: (side: Side, against: string) => void; onClose: () => void;
}) {
  const last = th.versions[th.versions.length - 1];
  const [side, setSide] = useState<Side>(last?.side === 'theirs' ? 'ours' : 'theirs');
  const [against, setAgainst] = useState(last?.id || '');
  const n = (last?.n || 0) + 1;
  const drop = useDrop(onDropFiles);
  return (
    <Modal title={t('加入新版本')} onClose={onClose} className="tpl-dlg add-ver"
      footer={<><button type="button" className="btn" onClick={onClose}>{t('取消')}</button><button type="button" className="btn primary" disabled={!file || busy} onClick={() => onDone(side, against)}>{t('加入并比较')}</button></>}>
      <button type="button" className={`dlg-drop ${drop.over ? 'over' : ''} ${file ? 'has' : ''}`} onClick={onPick} disabled={busy} {...drop.props}>
        {file
          ? <><I.FileGlyph type={file.ext || (/\.pdf$/i.test(file.name) ? 'pdf' : 'docx')} size={28} /><span className="nm">{file.name}</span><span className="sub">{t('V{n} · 点击或拖入可以换一份', { n })}</span></>
          : <><I.IconUpload /><span className="nm">{busy ? t('正在读取…') : t('拖入新的一版，或点击选择')}</span><span className="sub">{t('也可以直接拖到首页，DocDiff 会认出是哪份往来稿')}</span></>}
      </button>
      <div className="dlg-field">
        <div className="lbl">{t('这一版是')}</div>
        <Seg full value={side} onChange={setSide} label={t('这一版是')} options={[['theirs', t('对方发来的')], ['ours', t('我方改的')]]} />
      </div>
      <div className="dlg-field">
        <div className="lbl">{t('和哪一版比较')}</div>
        <div className="ver-list pick" role="radiogroup" aria-label={t('和哪一版比较')}>
          {[...th.versions].reverse().map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={against === v.id} className={`ver-row ${against === v.id ? 'on' : ''}`} onClick={() => setAgainst(v.id)}>
              <span className={`vn ${v.side}`}>V{v.n}</span><span className="sd">{sideLabel(v.side)}</span><span className="fn">{v.file.name}</span>
              <span className="pg">{v.id === last?.id ? t('上一版') : md(v.added)}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="cap">{t('文件会复制一份存进往来稿，原文件挪走、改名都不影响版本链。')}</p>
    </Modal>
  );
}

/** 审阅栏里的“上轮”提示：只有一行，只作参考 */
export function HintLine({ hint, th, onReuse }: { hint: Hint; th: Thread; onReuse: (v: Verdict) => void }) {
  const vb = th.versions.find((v) => v.id === hint.round.b);
  const r = vb ? `V${vb.n}` : t('上轮');
  const txt = hint.kind === 'reverted' ? t('{r} 你拒绝过这处修改，对方又改回来了', { r })
    : hint.kind === 'repeat' ? t('{r} 出现过同样的修改，你选了「{v}」', { r, v: t(VERB[hint.item.v!]) })
    : t('{r} 这条你{v}过：{a} → {b}', { r, v: t(VERB[hint.item.v!]), a: cut(hint.item.before || '∅'), b: cut(hint.item.after || '∅') });
  return (
    <div className={`rb-hint ${hint.kind}`}>
      <span className="pill">{txt}</span>
      {hint.reuse && <button type="button" className="link" onClick={() => onReuse(hint.reuse!)}>{t('沿用：{v}', { v: t(VERB[hint.reuse]) })}</button>}
    </div>
  );
}

/** 检查器里的条款历史 */
export function ClauseHistory({ clause, items, th }: { clause: string; items: { round: Round; item: RoundItem }[]; th: Thread }) {
  if (!items.length) return null;
  return (
    <div className="insp-block clause-hist">
      <div className="sh"><span className="t">{t('{c} · 条款历史', { c: cut(clause, 16) })}</span></div>
      {items.map(({ round, item }, i) => {
        const vb = th.versions.find((v) => v.id === round.b);
        return (
          <div key={i} className="ch-row">
            <span className={`vn ${vb?.side || ''}`}>V{vb?.n ?? '?'}</span>
            <span className="tx">{cut(item.before || '∅', 18)} → {cut(item.after || '∅', 18)}</span>
            <span className={`vd ${item.v || ''}`}>{item.v ? t(VERB[item.v]) : t('未决定')}</span>
          </div>
        );
      })}
    </div>
  );
}

export { Notice };
