// 1.9.5：文档里已有的批注（方案「1.9.5 · 批注」）：作者标签、纸边批注标、批注卡片、检查器列表、审阅栏提示、内部批注确认。
import React, { useMemo, useRef, useState } from 'react';
import type { CmThread, Owner, CmGroup } from '../lib/comments';
import { groupOf, GROUP_ORDER, anonymous } from '../lib/comments';
import type { DocComment } from '../lib/model';
import type { CmReply } from '../lib/commentStore';
import { t, isEn, colon } from '../lib/i18n';
import * as I from './icons';
import { Popover, MenuItem } from './Popover';
import { TextInput, Checkbox } from './Form';
import { Modal } from './Modal';
import { short } from './ChangeList';

/** 作者标签（AuthorTag）：对方 Fox / 我方 Macaw；对方稿里的我方内部批注 = 我方 · 内部（Bee + 提醒图标） */
export function AuthorTag({ owner, internal }: { owner: Owner; internal?: boolean }) {
  if (internal) return <span className="atag int"><I.IconWarn />{t('我方 · 内部')}</span>;
  return <span className={`atag ${owner}`}>{t(owner === 'ours' ? '我方' : '对方')}</span>;
}

/** 纸边批注标（CommentPin）：一段里的批注合成一个，数字是条数；颜色是作者归属（有对方的就按对方） */
export function CommentPin({ threads, open, label }: { threads: CmThread[]; open?: boolean; label?: string }) {
  const owner: Owner = threads.some((x) => x.owner === 'theirs') ? 'theirs' : 'ours';
  const keys = threads.map((x) => x.key).join(' ');
  return (
    <button type="button" className={`cm-pin ${owner}${open ? ' open' : ''}`} data-cmk={keys} aria-expanded={open || undefined}
      title={label || t('{n} 条批注', { n: threads.length })} aria-label={label || t('{n} 条批注', { n: threads.length })}>
      <I.IconComment size={14} /><span>{threads.length}</span>
    </button>
  );
}

export function fmtWhen(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const p = (x: number) => String(x).padStart(2, '0');
  const day = isEn() ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : `${d.getMonth() + 1}月${d.getDate()}日`;
  return d.getHours() || d.getMinutes() ? `${day} ${p(d.getHours())}:${p(d.getMinutes())}` : day;
}
const who = (c: DocComment) => (anonymous(c.author) ? t('（没有署名）') : c.author);

export interface CardActs {
  reviewer: string;
  replyOf: (key: string) => CmReply | undefined;
  onReply: (key: string, text: string | null) => void;
  onOwner: (key: string, o: Owner | null) => void;
  onAddMember: (name: string) => void;
  onDrop: (id: string, on: boolean) => void;
  dropped: (id: string) => boolean;
  isOurs: (name: string) => boolean;
}

/** 一条批注 + 它的回复（CommentCard）。Kind：Thread / Replying / Resolved / Internal */
export function CommentCard({ th, acts, onClose, autoReply }: { th: CmThread; acts: CardActs; onClose?: () => void; autoReply?: boolean }) {
  const mine = acts.replyOf(th.key);
  const [replying, setReplying] = useState(!!autoReply && th.side === 'b' && th.owner === 'theirs');
  const [draft, setDraft] = useState(mine?.text || '');
  const [open, setOpen] = useState(!th.resolved);
  const [menu, setMenu] = useState(false);
  const ownRef = useRef<HTMLButtonElement>(null);
  const canReply = th.side === 'b' && th.owner === 'theirs';
  const where = th.clause || t('开头部分');
  const item = (c: DocComment, reply: boolean, owner: Owner, internal = false) => (
    <div className={`cm-item${reply ? ' reply' : ''}`} key={c.id}>
      <div className="cm-meta"><AuthorTag owner={owner} internal={internal} /><b>{who(c)}</b><span className="cm-time">{fmtWhen(c.date)}</span></div>
      <div className="cm-text">{c.text || t('（空批注）')}</div>
    </div>
  );
  const save = () => { const v = draft.trim(); acts.onReply(th.key, v || null); setReplying(false); };
  return (
    <div className={`cm-card${th.internal ? ' internal' : ''}`} data-cm-card={th.key}>
      <div className="cm-head">
        <I.IconComment size={16} /><span className="cm-where" title={where}>{where}</span>
        {onClose && <button type="button" className="ibtn sm" onClick={onClose} aria-label={t('关闭')} title={t('关闭')}><I.IconX /></button>}
      </div>
      {th.resolved && !open ? (
        <>
          <div className="cm-meta"><AuthorTag owner={th.owner} /><b>{who(th.root)}</b><span className="cm-done">{t('已解决')}</span></div>
          <div className="cm-text one">{th.root.text}</div>
          <button type="button" className="link-btn cm-expand" onClick={() => setOpen(true)}>{th.replies.length ? t('展开（对方已标为已解决，{n} 条回复）', { n: th.replies.length }) : t('展开（对方已标为已解决）')}</button>
        </>
      ) : (
        <div className="cm-thread">
          {item(th.root, false, th.owner, th.internal)}
          {th.replies.map((r) => item(r, true, acts.isOurs(r.author) ? 'ours' : 'theirs', th.side === 'b' && acts.isOurs(r.author) && r.author.trim() !== acts.reviewer.trim()))}
          {mine && !replying && (
            <div className="cm-item reply mine">
              <div className="cm-meta"><AuthorTag owner="ours" /><b>{acts.reviewer}</b><span className="cm-time">{t('你的回复')}</span></div>
              <div className="cm-text">{mine.text}</div>
            </div>
          )}
          {replying && (
            <div className="cm-item reply mine editing">
              <div className="cm-meta"><AuthorTag owner="ours" /><b>{acts.reviewer}</b><span className="cm-time">{t('你的回复')}</span></div>
              <TextInput size="s" autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} aria-label={t('回复')} data-own-esc
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); setReplying(false); setDraft(mine?.text || ''); } }} />
              <div className="cm-cap">{t('生成审阅稿时，作为这条批注的回复写进 Word。')}</div>
            </div>
          )}
        </div>
      )}
      {th.onDeleted && <div className="cm-note"><I.IconInfo />{t('批注所在的文字被对方删了：“{q}”', { q: short(th.root.delText || '', 40) })}</div>}
      {th.side === 'a' && <div className="cm-note"><I.IconComment size={16} />{th.gone ? t('批注在我方稿里，这段文字被对方删了。') : th.changedByThem ? t('批注在我方稿里，这段文字被对方改过。') : t('批注在我方稿里（这段文字两边一样，没有修订）。')}</div>}
      {th.internal && !acts.dropped(th.root.id) && (
        <div className="cm-warn"><I.IconWarn /><span>{t('这条在对方稿里，生成审阅稿时会一起发给对方。')}</span></div>
      )}
      {th.internal && acts.dropped(th.root.id) && <div className="cm-note"><I.IconInfo />{t('生成审阅稿时不带入这条。')}</div>}
      <div className="cm-acts">
        {replying ? (
          <>
            <span className="grow" />
            <button type="button" className="btn sm" onClick={() => { setReplying(false); setDraft(mine?.text || ''); }}>{t('取消')}</button>
            <button type="button" className="btn sm blue" onClick={save}>{t('保存回复')}</button>
          </>
        ) : (
          <>
            {canReply && <button type="button" className="btn sm" onClick={() => { setOpen(true); setReplying(true); }}>{t(mine ? '改回复' : '回复')}</button>}
            {mine && !replying && <button type="button" className="btn sm plain" onClick={() => { acts.onReply(th.key, null); setDraft(''); }}>{t('删掉回复')}</button>}
            {th.internal && <button type="button" className="btn sm" onClick={() => acts.onDrop(th.root.id, !acts.dropped(th.root.id))}>{t(acts.dropped(th.root.id) ? '改回带入' : '生成时不带入')}</button>}
            <span className="grow" />
            <button ref={ownRef} type="button" className="link-btn" onClick={() => setMenu(!menu)} aria-expanded={menu}>{t('作者归属：{o} · 改', { o: t(th.owner === 'ours' ? '我方' : '对方') })}</button>
          </>
        )}
      </div>
      <Popover anchor={ownRef} open={menu} onClose={() => setMenu(false)} width={260} className="pop-menu" label={t('作者归属')}>
        <MenuItem icon={th.owner === 'theirs' ? <I.IconCheck /> : <I.IconPlusDoc />} onClick={() => { setMenu(false); acts.onOwner(th.key, 'theirs'); }}>{t('这是对方的批注')}</MenuItem>
        <MenuItem icon={th.owner === 'ours' ? <I.IconCheck /> : <I.IconPlusDoc />} onClick={() => { setMenu(false); acts.onOwner(th.key, 'ours'); }}>{t('这是我方的批注')}</MenuItem>
        {!anonymous(th.root.author) && !acts.isOurs(th.root.author) && <MenuItem icon={<I.IconPlusDoc />} onClick={() => { setMenu(false); acts.onAddMember(th.root.author.trim()); }}>{t('把「{n}」加进我方成员', { n: th.root.author.trim() })}</MenuItem>}
      </Popover>
    </div>
  );
}

/** 批注卡片的弹出层：贴着批注标（或检查器里的行）弹出；同一段有几条就依次列出 */
export function CommentPop({ anchor, threads, acts, onClose, autoReply }: { anchor: React.RefObject<HTMLElement>; threads: CmThread[]; acts: CardActs; onClose: () => void; autoReply?: boolean }) {
  return (
    <Popover anchor={anchor} open={threads.length > 0} onClose={onClose} width={340} align="end" className="cm-pop" label={t('批注')}>
      {threads.map((th, i) => <CommentCard key={th.key} th={th} acts={acts} onClose={i === 0 ? onClose : undefined} autoReply={autoReply && i === 0} />)}
    </Popover>
  );
}

const GROUP_TITLE: Record<CmGroup, string> = { changed: '同事批过、被对方改了', theirs: '对方批注', resolved: '对方已解决', ours: '我方批注', plain: '没有修订的地方' };

/** 检查器「批注 N」：分组列出（H2） */
export function CommentList({ threads, sel, onSel, acts }: { threads: CmThread[]; sel: string | null; onSel: (th: CmThread, el: HTMLElement) => void; acts: CardActs }) {
  const [showDone, setShowDone] = useState(false);
  const groups = useMemo(() => {
    const m = new Map<CmGroup, CmThread[]>();
    for (const th of threads) { const g = groupOf(th); (m.get(g) || m.set(g, []).get(g)!).push(th); }
    // 对方批注：没回复的在前
    m.get('theirs')?.sort((x, y) => Number(x.replied) - Number(y.replied) || (x.row ?? 0) - (y.row ?? 0));
    return GROUP_ORDER.filter((g) => m.get(g)?.length).map((g) => ({ g, items: m.get(g)! }));
  }, [threads]);
  if (!threads.length) return <div className="dlist-empty">{t('这两份文件里没有批注')}</div>;
  const state = (th: CmThread) => {
    if (th.side === 'a') return th.gone ? t('已删') : th.changedByThem ? t('被改过') : t('我方稿');
    if (th.onDeleted) return t('已删');
    if (th.owner === 'theirs') return th.resolved ? t('已解决') : th.replied ? t('已回复') : t('未回复');
    return th.internal ? t('内部') : '';
  };
  const row = (th: CmThread) => (
    <button key={th.key} type="button" data-cm-row={th.key} className={`cm-row${sel === th.key ? ' sel' : ''}`} aria-current={sel === th.key}
      onClick={(e) => onSel(th, e.currentTarget)} title={th.root.text}>
      <span className="cm-meta"><AuthorTag owner={th.owner} internal={th.internal && !acts.dropped(th.root.id)} /><b className="grow">{who(th.root)}</b><span className="cm-st">{[th.clause, state(th)].filter(Boolean).join(' · ')}</span></span>
      <span className="cm-text two">{th.root.text}</span>
    </button>
  );
  return (
    <div className="dlist cm-list">
      {groups.map(({ g, items }) => g === 'resolved' ? (
        <div className="dgroup" key={g}>
          <div className="cm-fold"><span>{t('对方已解决 {n} 条', { n: items.length })}</span><button type="button" className="link-btn" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>{t(showDone ? '收起' : '展开')}</button></div>
          {showDone && items.map(row)}
        </div>
      ) : (
        <div className="dgroup" key={g}>
          <div className="grp">{t(GROUP_TITLE[g])}</div>
          {items.map(row)}
        </div>
      ))}
    </div>
  );
}

/** 审阅栏第二行（H3）：这处修订上的批注；审完最后一处时提“还有 N 条不在修订上” */
export function CommentHint({ th, more, rest, onOpen, onReply, onRest }: { th: CmThread | null; more: number; rest: number; onOpen: (el: HTMLElement) => void; onReply: (el: HTMLElement) => void; onRest: () => void }) {
  if (th) {
    const lead = th.side === 'a' ? t('同事批过：') : th.owner === 'theirs' ? t('对方批注：') : th.internal ? t('同事批过：') : t('我方批注：');
    return (
      <div className={`rb-cm ${th.owner}`} role="note">
        <CommentPin threads={[th]} />
        <span className="tx">{lead}{short(th.root.text, 80)}{more > 0 ? t('（等 {n} 条）', { n: more + 1 }) : ''}</span>
        <button type="button" className="link-btn" onClick={(e) => onOpen(e.currentTarget)}>{t('查看')}</button>
        {th.side === 'b' && th.owner === 'theirs' && <button type="button" className="link-btn" onClick={(e) => onReply(e.currentTarget)}>{t('回复')}</button>}
      </div>
    );
  }
  if (rest > 0) return (
    <div className="rb-cm theirs" role="note">
      <span className="cm-pin theirs static"><I.IconComment size={14} /><span>{rest}</span></span>
      <span className="tx">{t('还有 {n} 条批注不在修订上。不计入审阅进度。', { n: rest })}</span>
      <button type="button" className="link-btn" onClick={onRest}>{t('查看')}</button>
    </div>
  );
  return null;
}

/** 不带入内部批注：确认一次，列出哪几条（H5 ③） */
export function DropInternalModal({ items, onOk, onClose }: { items: { id: string; author: string; text: string; clause: string | null }[]; onOk: (ids: string[]) => void; onClose: () => void }) {
  const [on, setOn] = useState<Set<string>>(() => new Set(items.map((x) => x.id)));
  return (
    <Modal title={t('不带入内部批注？')} onClose={onClose} mood="think"
      footer={<><button type="button" className="btn" onClick={onClose}>{t('取消')}</button><button type="button" className="btn blue" disabled={!on.size} onClick={() => onOk([...on])}>{t('不带入这 {n} 条', { n: on.size })}</button></>}>
      <p className="modal-p">{t('勾上的批注不会写进要发给对方的审阅稿；DocDiff 里和你的存档里仍然保留。')}</p>
      <div className="cm-drop-list">
        {items.map((x) => (
          <Checkbox key={x.id} checked={on.has(x.id)} onChange={(v) => setOn((s) => { const n = new Set(s); if (v) n.add(x.id); else n.delete(x.id); return n; })}>
            <span className="cm-drop-tx">{x.author}{' · '}{x.clause || t('开头部分')}{colon()}{short(x.text, 24)}</span>
          </Checkbox>
        ))}
      </div>
    </Modal>
  );
}
