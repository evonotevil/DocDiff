import React, { useEffect, useRef, useState } from 'react';
import { t, isEn, fmtShortDate } from '../lib/i18n';
import * as I from './icons';
import { EmptyCard } from './Library';
import { Popover, MenuItem } from './Popover';
import { Modal } from './Modal';
import { Notice } from './Panel';
import { Seg, MidName, TypeTag, Info } from './ui';
import { Select } from './Form';
import { useDrop } from '../lib/drop';
import type { FileInfo } from '../lib/model';
import type { Thread, ThreadVersion, Side, Template } from '../lib/library';
import { defaultPair, roundOf } from '../lib/library';
import type { Hint } from '../lib/hints';
import type { RoundItem, Round } from '../lib/library';
import type { Verdict } from '../lib/review';

const md = (ms: number) => { const d = new Date(ms); return isEn() ? fmtShortDate(ms) : t('{m}月{d}日', { m: d.getMonth() + 1, d: d.getDate() }); };
const sideLabel = (s: Side) => (s === 'ours' ? t('我方') : t('对方'));
const VERB: Record<Verdict, string> = { a: '接受', r: '拒绝', h: '待议' };
const cut = (s: string, n = 24) => (s.length > n ? s.slice(0, n) + '…' : s);

/** 首页「往来稿」页签里的列表（1.9.1：放进首页左卡片的页签，标题和归档切换在卡片标题条上） */
export function ThreadsList({ threads, archived, onOpen, onRename, onArchive, onDelete, onDemo }: {
  threads: Thread[]; archived?: boolean; onOpen: (th: Thread) => void; onRename: (th: Thread, name: string) => void;
  onArchive: (th: Thread, on: boolean) => void; onDelete: (th: Thread) => void; onDemo?: () => void;
}) {
  if (threads.length === 0 && !archived) return <EmptyCard illo={<I.IlloLib size={72} />} title={t('还没有往来稿')} desc={t('比较完点工具栏的文件片，或最近比较里的「…」，存为往来稿；对方再发来新版本时接着比。')} demo={onDemo} />;
  return <div className="lib-rows">{threads.map((th) => <ThreadRow key={th.id} th={th} onOpen={onOpen} onRename={onRename} onArchive={onArchive} onDelete={onDelete} />)}</div>;
}

function ThreadRow({ th, onOpen, onRename, onArchive, onDelete }: { th: Thread; onOpen: (th: Thread) => void; onRename: (th: Thread, n: string) => void; onArchive: (th: Thread, on: boolean) => void; onDelete: (th: Thread) => void }) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const last = th.versions[th.versions.length - 1];
  // 显示完整的版本对（上次打开的那一对，可能不相邻），进度也按这一对算（beta.5）
  const dp = defaultPair(th);
  const r = dp ? roundOf(th, dp.a.id, dp.b.id) : null;
  const prog = r ? (r.decided >= r.total ? t('已审完') : t('待审 {n} 处', { n: r.total - r.decided })) : '';
  const meta = [dp ? `V${dp.a.n} → V${dp.b.n}` : last ? `V${last.n}` : '', prog, last ? md(last.added) : ''].filter(Boolean).join(' · ');
  return (
    // 1.8.1：行本身不是按钮，“打开”由铺满整行的透明按钮承担
    <div className="lib-row">
      {edit === null && <button type="button" className="row-open" title={th.name} aria-label={t('打开往来稿「{n}」', { n: th.name })} onClick={() => onOpen(th)} />}
      <I.FileGlyph type={last?.file.ext || 'docx'} size={22} />
      {edit !== null
        ? <input className="tin s lib-edit" autoFocus value={edit} onClick={(e) => e.stopPropagation()} onChange={(e) => setEdit(e.target.value)} aria-label={t('往来稿名称')}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && edit.trim()) { onRename(th, edit.trim()); setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
            onBlur={() => { if (edit.trim() && edit.trim() !== th.name) onRename(th, edit.trim()); setEdit(null); }} />
        : <span className="nm" title={th.name}>{th.name}</span>}
      <span className="meta">{meta}</span>
      <button ref={more} type="button" className="btn sm plain icon" aria-label={t('更多')} title={t('更多')} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><I.IconMore /></button>
      <Popover anchor={more} open={menu} onClose={() => setMenu(false)} width={260} title={th.name}>
        <MenuItem icon={<I.IconEdit />} onClick={() => { setMenu(false); setEdit(th.name); }}>{t('重命名')}</MenuItem>
        <MenuItem icon={<I.IconCheck />} onClick={() => { setMenu(false); onArchive(th, !th.archived); }}>{th.archived ? t('取消归档') : t('归档（签完了）')}</MenuItem>
        <MenuItem icon={<I.IconX />} tone="danger" onClick={() => { setMenu(false); onDelete(th); }}>{t('删除往来稿')}</MenuItem>
      </Popover>
    </div>
  );
}

/** 往来稿里的工具栏：合同名 + 正在比的两版，点开是版本链（代替两个文件片） */
/** 版本的显示名：有名称时「V3 · 名称」（1.9.1） */
/** 版本选项（1.9.4，和版本链同一写法）：V 编号（我方 Macaw、对方 Fox）+ 我方 / 对方 + 名称；名称放不下就省略，悬停看全名 */
function VerOpt({ v }: { v: ThreadVersion }) {
  const name = v.label || v.file.name;
  return <><span className={`vopt-n ${v.side === 'ours' ? 'me' : 'them'}`}>V{v.n}</span><span className="vopt-s">{sideLabel(v.side)}</span><span className="vopt-l" title={name}>{name}</span></>;
}
export const verName = (v: ThreadVersion) => (v.label ? `V${v.n} · ${v.label}` : `V${v.n}`);

export function VersionChip({ th, a, b, tpl, progress, onPick, onAdd, onRename, onDropFiles, onLabel, onDeleteVersion }: {
  th: Thread; a: string; b: string; tpl?: Template | null;
  progress: (v: ThreadVersion) => string;
  onPick: (a: ThreadVersion, b: ThreadVersion) => void; onAdd: () => void; onRename: (n: string) => void;
  /** 1.9.1：给一版起名（空 = 去掉名称）、删除一版 */
  onLabel: (v: ThreadVersion, label: string) => void; onDeleteVersion: (v: ThreadVersion) => void;
  /** 1.8：把新版本直接拖到版本片或弹出层上 */
  onDropFiles: (f: FileInfo[]) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const va = th.versions.find((v) => v.id === a), vb = th.versions.find((v) => v.id === b);
  const tv = tpl && th.tpl ? tpl.versions.find((v) => v.id === th.tpl!.vid) : null;
  const nextN = Math.max(0, ...th.versions.map((v) => v.n)) + 1;
  const [pa, setPa] = useState(a), [pb, setPb] = useState(b);
  /** 收起时名称放不下就省略，悬停提示写全名 */
  const fullName = (id: string) => { const v = th.versions.find((x) => x.id === id); return v ? `V${v.n} · ${sideLabel(v.side)} · ${v.label || v.file.name}` : ''; };
  useEffect(() => { if (open) { setPa(a); setPb(b); } }, [open, a, b]);
  // 比较过的版本对（不只相邻的），最近的在前
  const pairs = [...th.rounds].sort((p, q) => q.updated - p.updated).slice(0, 6)
    .map((r) => ({ r, x: th.versions.find((v) => v.id === r.a)!, y: th.versions.find((v) => v.id === r.b)! })).filter((p) => p.x && p.y);
  const drop = useDrop((fs) => { setOpen(false); onDropFiles(fs); });
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [labelEdit, setLabelEdit] = useState<{ id: string; v: string } | null>(null);
  const moreRefs = useRef(new Map<string, HTMLButtonElement>());
  const menuAnchor = useRef<HTMLElement | null>(null);
  useEffect(() => { if (!open) { setMenuFor(null); setLabelEdit(null); } }, [open]);
  const saveLabel = () => { if (!labelEdit) return; const v = th.versions.find((x) => x.id === labelEdit.id); if (v && (v.label || '') !== labelEdit.v.trim()) onLabel(v, labelEdit.v.trim()); setLabelEdit(null); };
  const chipTitle = [th.name, ...[va, vb].filter((v): v is ThreadVersion => !!v && !!v.label).map(verName)].join('\n');
  // 拖着文件经过版本片：弹出层自动打开，整块变成放置区
  const chipDrag = {
    onDragEnter: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOpen(true); } },
    onDragOver: drop.props.onDragOver, onDragLeave: drop.props.onDragLeave, onDrop: drop.props.onDrop,
  };
  return (
    <>
      <button ref={ref} type="button" className={`btn ver-chip ${drop.over ? 'over' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} title={chipTitle} {...chipDrag}>
        <MidName name={th.name} title={false} />
        <span className="vv">{va ? `V${va.n}` : '?'} → {vb ? `V${vb.n}` : '?'}</span>
        <I.IconDown />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={380} align="start" className={drop.over ? 'ver-dropping' : ''}
        title={edit !== null
          ? <input className="tin s lib-edit" autoFocus value={edit} onChange={(e) => setEdit(e.target.value)} aria-label={t('往来稿名称')}
              onKeyDown={(e) => { if (e.key === 'Enter' && edit.trim()) { onRename(edit.trim()); setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
              onBlur={() => { if (edit.trim()) onRename(edit.trim()); setEdit(null); }} />
          : <span className="ver-head"><span className="ver-name" title={th.name}>{th.name}</span><button type="button" className="link-btn" onClick={() => setEdit(th.name)}>{t('重命名')}</button></span>}>
        <div className="ver-pop" {...drop.props}>
          {drop.over ? (
            <div className="ver-drop"><I.IconUpload /><b>{t('松手加入为 V{n}', { n: nextN })}</b><span>{t('下一步确认是谁改的、和哪一版比较')}</span></div>
          ) : <>
          {tpl && tv && <p className="cap">{t('基于模板：{n} {v}', { n: tpl.name, v: tv.label })}</p>}
          <div className="ver-list">
            {th.versions.map((v, i) => {
              const cur = v.id === b;
              if (labelEdit?.id === v.id) {
                return (
                  <div key={v.id} className="ver-item">
                    <div className="ver-row edit">
                      <span className={`vn ${v.side}`}>V{v.n}</span>
                      <span className="sd">{sideLabel(v.side)}</span>
                      <input className="ver-label" autoFocus data-own-esc value={labelEdit.v} maxLength={40} placeholder={v.file.name} aria-label={t('V{n} 的名称', { n: v.n })}
                        onChange={(e) => setLabelEdit({ id: v.id, v: e.target.value })}
                        onKeyDown={(e) => { if (e.key === 'Enter') saveLabel(); if (e.key === 'Escape') { e.stopPropagation(); setLabelEdit(null); } }}
                        onBlur={saveLabel} />
                    </div>
                    <p className="cap ver-edit-hint">{t('回车保存 · Esc 取消 · 清空就只显示文件名')}</p>
                  </div>
                );
              }
              return (
                <div key={v.id} className={`ver-item ${menuFor === v.id ? 'menu' : ''}`}>
                  <button type="button" className={`ver-row ${cur ? 'on' : ''} ${v.id === a ? 'base' : ''}`} disabled={i === 0}
                    title={[v.label ? v.file.name : '', i === 0 ? t('第一版') : t('和上一版（V{n}）比较', { n: th.versions[i - 1].n })].filter(Boolean).join('\n')}
                    onClick={() => { if (i > 0) { setOpen(false); onPick(th.versions[i - 1], v); } }}>
                    <span className={`vn ${v.side}`}>V{v.n}</span>
                    <span className="sd">{sideLabel(v.side)}</span>
                    {v.label ? <span className="fn lbl">{v.label}</span> : <MidName name={v.file.name} />}
                    <span className="pg">{i > 0 ? progress(v) : md(v.added)}</span>
                  </button>
                  <button type="button" className="ibtn sm ver-more" aria-label={t('V{n} 的更多操作', { n: v.n })} title={t('更多')} aria-expanded={menuFor === v.id}
                    ref={(el) => { if (el) moreRefs.current.set(v.id, el); else moreRefs.current.delete(v.id); }}
                    onClick={(e) => { menuAnchor.current = e.currentTarget; setMenuFor(menuFor === v.id ? null : v.id); }}><I.IconMore /></button>
                </div>
              );
            })}
            {menuFor && (() => {
              const v = th.versions.find((x) => x.id === menuFor);
              if (!v) return null;
              const few = th.versions.length <= 2;
              return (
                <Popover anchor={menuAnchor as React.RefObject<HTMLElement>} open onClose={() => setMenuFor(null)} width={220} className="pop-menu" label={t('V{n} 的更多操作', { n: v.n })}>
                  <MenuItem icon={<I.IconEdit />} onClick={() => { setMenuFor(null); setLabelEdit({ id: v.id, v: v.label || '' }); }}>{t('起名…')}</MenuItem>
                  <MenuItem icon={<I.IconX />} tone="danger" disabled={few} title={few ? t('至少要留两版才能比较。整份不要了，可以在首页删除往来稿。') : undefined}
                    onClick={() => { if (few) return; setMenuFor(null); onDeleteVersion(v); }}>{t('删除这一版')}</MenuItem>
                </Popover>
              );
            })()}
          </div>
          {pairs.length > 0 && (
            <div className="ver-pairs">
              <div className="grp">{t('比较过的')}</div>
              {pairs.map(({ r, x, y }) => (
                <button key={r.a + r.b} type="button" className={`ver-pair ${r.a === a && r.b === b ? 'on' : ''}`} onClick={() => { setOpen(false); onPick(x, y); }}>
                  <span className="pr">V{x.n} → V{y.n}</span><span className="pg">{r.decided >= r.total ? t('已审完') : t('已审 {d} / {n}', { d: r.decided, n: r.total })}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grp">{t('换个比较')}</div>
          <div className="ver-pick">
            <Select size="s" className="vp" label={t('原始版本')} value={pa} minWidth={260} title={fullName(pa)}
              onChange={(id) => { setPa(id); const na = th.versions.find((v) => v.id === id)!.n; if ((th.versions.find((v) => v.id === pb)?.n || 0) <= na) setPb(th.versions.find((v) => v.n > na)?.id || pb); }}
              options={th.versions.slice(0, -1).map((v) => ({ value: v.id, label: <VerOpt v={v} />, text: `V${v.n}` }))} />
            <span className="arr" aria-hidden="true">→</span>
            <Select size="s" className="vp" label={t('修改后版本')} value={pb} minWidth={260} title={fullName(pb)} onChange={setPb}
              options={th.versions.filter((v) => v.n > (th.versions.find((x) => x.id === pa)?.n || 0)).map((v) => ({ value: v.id, label: <VerOpt v={v} />, text: `V${v.n}` }))} />
            <button type="button" className="btn sm" disabled={pa === a && pb === b} onClick={() => { const x = th.versions.find((v) => v.id === pa), y = th.versions.find((v) => v.id === pb); if (x && y) { setOpen(false); onPick(x, y); } }}>{t('比较')}</button>
          </div>
          <p className="cap">{t('点一版就和它的上一版比较 · 也可以把新版本拖到这里')}</p>
          <div className="acts"><button type="button" className="btn sm" onClick={() => { setOpen(false); onAdd(); }}><I.IconUpload />{t('加入新版本…')}</button></div>
          </>}
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
  const base = th.versions.find((v) => v.id === against);
  const drop = useDrop(onDropFiles);
  const prog = (v: ThreadVersion) => { const r = th.rounds.find((x) => x.b === v.id); return r ? (r.decided >= r.total ? t('已审完') : t('已审 {d} / {n}', { d: r.decided, n: r.total })) : ''; };
  const ext = file ? (file.ext || (/\.pdf$/i.test(file.name) ? 'pdf' : /\.(txt|md)$/i.test(file.name) ? 'txt' : 'docx')) : 'docx';
  return (
    <Modal title={t('加入新版本')} onClose={onClose} className="tpl-dlg add-ver spec"
      footer={<><button type="button" className="btn big" onClick={onClose}>{t('取消')}</button>
        <button type="button" className="btn big primary" disabled={!file || busy} onClick={() => onDone(side, against)}>{t('加入并比较 V{a} → V{b}', { a: base?.n ?? '?', b: n })}</button></>}>
      <p className="dlg-sub">{t('{name} · 目前到 V{n}', { name: th.name, n: last?.n ?? 0 })}</p>
      {file
        ? <div className={`file-row ${drop.over ? 'over' : ''}`} {...drop.props}><TypeTag type={ext} /><MidName name={file.name} /><button type="button" className="btn sm plain link-btn" onClick={onPick} disabled={busy}>{t('更换')}</button></div>
        : <button type="button" className={`dlg-drop ${drop.over ? 'over' : ''}`} onClick={onPick} disabled={busy} {...drop.props}>
            <I.IconUpload /><span className="nm">{busy ? t('正在读取…') : t('拖入新版本，或点击选择')}</span><span className="sub">{t('.docx / .pdf / .txt · 也可以直接拖到首页，DocDiff 会认出是哪份往来稿')}</span>
          </button>}
      <div className="dlg-field">
        <div className="lbl">{t('这一版是谁改的')}</div>
        <Seg full value={side} onChange={setSide} label={t('这一版是谁改的')} options={[['theirs', t('对方改的')], ['ours', t('我方改的')]]} />
        {last && <div className="dlg-hint">{last.side === 'theirs' ? t('上一版（V{n}）是对方的，所以默认“我方改的”。', { n: last.n }) : t('上一版（V{n}）是我方的，所以默认“对方改的”。', { n: last.n })}</div>}
      </div>
      <div className="dlg-field">
        <div className="grp">{t('将加为 V{n} · 和哪一版比较', { n })}</div>
        <div className="ver-list pick" role="radiogroup" aria-label={t('和哪一版比较')}>
          {[...th.versions].reverse().map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={against === v.id} className={`ver-row ${against === v.id ? 'on' : ''}`} onClick={() => setAgainst(v.id)} title={v.file.name}>
              <span className={`vn ${v.side}`}>V{v.n}</span><span className="sd">{sideLabel(v.side)}</span>{v.label ? <span className="fn lbl">{v.label}</span> : <MidName name={v.file.name} title={false} />}
              <span className="pg">{[md(v.added), prog(v)].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      </div>
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
