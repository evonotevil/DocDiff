import React, { useMemo, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Popover, MenuItem } from './Popover';
import { Modal } from './Modal';
import { Notice } from './Panel';
import type { DocModel, FileInfo } from '../lib/model';
import { useDrop } from '../lib/drop';
import { MidName, TypeTag } from './ui';
import { type Template, type TplVersion, type Library as Lib, pick, live, fingerprint } from '../lib/library';

const pct = (x: number) => `${Math.round(x * 100)}%`;
const md = (ms: number) => { const d = new Date(ms); return t('{m}月{d}日', { m: d.getMonth() + 1, d: d.getDate() }); };

/** 首页「模板」栏（1.8） */
export function TemplatesCard({ lib, threadCount, onUse, onNew, onAddVersion, onRename, onDelete, onDeleteVersion, busy }: {
  lib: Lib; threadCount: (tid: string) => number;
  onUse: (tpl: Template) => void; onNew: () => void; onAddVersion: (tpl: Template) => void;
  onRename: (tpl: Template, name: string) => void; onDelete: (tpl: Template) => void; onDeleteVersion: (tpl: Template, v: TplVersion) => void;
  busy?: boolean;
}) {
  const tpls = live(lib.templates);
  return (
    <section className="lib-card" aria-label={t('模板')}>
      <h2>{t('模板')}{tpls.length > 0 && <span className="cnt">{tpls.length}</span>}<span className="grow" />
        <button type="button" className="btn sm" onClick={onNew} disabled={busy}><I.IconPlusDoc />{t('新建模板')}</button>
      </h2>
      {tpls.length === 0
        ? <p className="lib-empty">{t('把你的标准合同存成模板。对方改稿来了，只放对方的文件就能比，DocDiff 会自动找出对方是在哪一版上改的。')}</p>
        : <div className="lib-rows">{tpls.map((tp) => <TemplateRow key={tp.id} tpl={tp} n={threadCount(tp.id)} onUse={onUse} onAddVersion={onAddVersion} onRename={onRename} onDelete={onDelete} onDeleteVersion={onDeleteVersion} />)}</div>}
      <p className="lib-foot">{t('模板只存你自己的标准稿，存的是拷贝；原文件挪走、改名都不影响。')}</p>
    </section>
  );
}

function TemplateRow({ tpl, n, onUse, onAddVersion, onRename, onDelete, onDeleteVersion }: {
  tpl: Template; n: number; onUse: (t: Template) => void; onAddVersion: (t: Template) => void;
  onRename: (t: Template, name: string) => void; onDelete: (t: Template) => void; onDeleteVersion: (t: Template, v: TplVersion) => void;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const latest = tpl.versions[tpl.versions.length - 1];
  const meta = [t('{n} 个版本', { n: tpl.versions.length }), latest ? t('最新 {v}', { v: latest.label }) : '', n ? t('{n} 份往来稿', { n }) : ''].filter(Boolean).join(' · ');
  return (
    <div className="lib-row" role="button" tabIndex={0} onClick={() => edit === null && onUse(tpl)} onKeyDown={(e) => { if (e.target === e.currentTarget && edit === null && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onUse(tpl); } }}>
      <I.FileGlyph type={latest?.file.ext || 'docx'} size={22} />
      {edit !== null
        ? <input className="lib-edit" autoFocus value={edit} onClick={(e) => e.stopPropagation()} onChange={(e) => setEdit(e.target.value)}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && edit.trim()) { onRename(tpl, edit.trim()); setEdit(null); } if (e.key === 'Escape') setEdit(null); }}
            onBlur={() => { if (edit.trim() && edit.trim() !== tpl.name) onRename(tpl, edit.trim()); setEdit(null); }} aria-label={t('模板名称')} />
        : <span className="nm" title={tpl.name}>{tpl.name}</span>}
      <span className="meta">{meta}</span>
      <button ref={more} type="button" className="btn sm plain icon" aria-label={t('更多')} title={t('更多')} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><I.IconMore /></button>
      <Popover anchor={more} open={menu} onClose={() => setMenu(false)} width={300} title={tpl.name}>
        <div onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<I.IconSwap />} onClick={() => { setMenu(false); onUse(tpl); }}>{t('用它比较…')}</MenuItem>
          <MenuItem icon={<I.IconUpload />} onClick={() => { setMenu(false); onAddVersion(tpl); }}>{t('上传新版本…')}</MenuItem>
          <MenuItem icon={<I.IconEdit />} onClick={() => { setMenu(false); setEdit(tpl.name); }}>{t('重命名')}</MenuItem>
          {tpl.versions.length > 1 && <div className="lib-vers">
            <div className="grp">{t('版本')}</div>
            {[...tpl.versions].reverse().map((v) => (
              <div key={v.id} className="lib-ver"><span className="l">{v.label}</span><span className="d">{md(v.added)}</span>
                <button type="button" className="btn sm plain icon" title={t('删除这个版本')} aria-label={t('删除这个版本')} onClick={() => { setMenu(false); onDeleteVersion(tpl, v); }}><I.IconX /></button>
              </div>
            ))}
          </div>}
          <MenuItem icon={<I.IconX />} tone="danger" onClick={() => { setMenu(false); onDelete(tpl); }}>{t('删除模板')}</MenuItem>
        </div>
      </Popover>
    </div>
  );
}

/** 用模板比较：放入对方文件 → 自动选出对方是在哪一版上改的 → 开始比较 */
export function TemplateCompareDialog({ tpl, B, bBusy, onPickB, onDropB, onStart, onClose }: {
  tpl: Template; B: DocModel | null; bBusy: boolean;
  onPickB: () => void; onDropB: (f: FileInfo[]) => void; onStart: (v: TplVersion) => void; onClose: () => void;
}) {
  const drop = useDrop(onDropB);
  const res = useMemo(() => (B ? pick(fingerprint(B), tpl.versions) : null), [B, tpl]);
  const [sel, setSel] = useState<string | null>(null);
  const chosen = sel ?? (res?.best && !res.tie ? res.best.item.id : tpl.versions.length === 1 ? tpl.versions[0].id : null);
  const score = (v: TplVersion) => res?.ranked.find((r) => r.item.id === v.id)?.score;
  const ordered = res ? res.ranked.map((r) => r.item) : [...tpl.versions].reverse();
  const best = res?.best;
  const others = res?.ranked.filter((r) => r.item.id !== best?.item.id) || [];
  return (
    <Modal title={t('用模板比较')} onClose={onClose} className="tpl-dlg spec"
      footer={<><button type="button" className="btn big" onClick={onClose}>{t('取消')}</button>
        <button type="button" className="btn big primary" disabled={!B || !chosen} onClick={() => onStart(tpl.versions.find((v) => v.id === chosen)!)}>{t('开始比较')}</button></>}>
      <div className="pair">
        <div className="pair-row"><span className="role">{t('原始文档')}</span><I.FileGlyph type={tpl.versions[0]?.file.ext || 'docx'} size={22} /><span className="nm">{tpl.name}</span>
          <span className="tag">{chosen ? tpl.versions.find((v) => v.id === chosen)?.label : t('待选版本')}</span></div>
        <button type="button" className={`pair-row pick ${drop.over ? 'over' : ''}`} onClick={onPickB} disabled={bBusy} {...drop.props}>
          <span className="role">{t('修改后文档')}</span>
          {B ? <><I.FileGlyph type={B.type} size={22} /><span className="nm">{B.file.name}</span><span className="tag">{t('对方')}</span></>
            : <span className="nm hint">{bBusy ? t('正在读取…') : t('拖入对方发来的文件，或点击选择')}</span>}
        </button>
      </div>
      {B && res && tpl.versions.length > 1 && (
        best
          ? (res.tie
            ? <Notice tone="warn" title={t('有两个版本都很像，请选一个')}>{t('相同段落 {a} 和 {b}，差得太少，不替你选。', { a: pct(best.score), b: pct(others[0].score) })}</Notice>
            : <Notice tone="info" title={t('自动选了 {v}', { v: best.item.label })}>{t('对方文件和它相同的段落最多（{a}）{rest}。模板发出后你可能又改过，用对方实际拿到的那一版来比，才不会把你自己的改动算成对方的。', { a: pct(best.score), rest: others.length ? t('，{v} 只有 {b}', { v: others[0].item.label, b: pct(others[0].score) }) : '' })}</Notice>)
          : <Notice tone="warn" title={t('看不出对方是在哪一版上改的')}>{t('和每个版本相同的段落都不到一半。可能不是这份模板，也可以手动选一个版本。')}</Notice>
      )}
      {tpl.versions.length > 1 && (
        <div className="choice" role="radiogroup" aria-label={t('模板版本')}>
          <div className="grp">{t('模板版本')}</div>
          {ordered.map((v) => {
            const s = score(v);
            return (
              <button key={v.id} type="button" role="radio" aria-checked={chosen === v.id} className={`menu-item ${chosen === v.id ? 'on' : ''}`} onClick={() => setSel(v.id)}>
                {chosen === v.id ? <I.IconCheck /> : <span className="sp" />}<span className="grow">{v.label}</span>
                {s !== undefined && <span className="meta">{t('相同段落 {p}', { p: pct(s) })}{best && !res!.tie && best.item.id === v.id ? ' · ' + t('推荐') : ''}</span>}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

/** 首页：只放了对方文件时，认出它像哪个模板（M3 起也认往来稿） */
export function MatchNotice({ title, body, action, onUse, onDismiss }: { title: string; body: string; action: string; onUse: () => void; onDismiss: () => void }) {
  return (
    <Notice tone="info" className="lib-match" title={title}
      action={<button type="button" className="btn sm primary" onClick={onUse}>{action}</button>} onClose={onDismiss} closeLabel={t('不用')}>
      {body}
    </Notice>
  );
}

/** 「最近比较」的一行（beta.3 两行式）：第一行两份文件各带类型标签、中间省略、→ 在固定列；第二行时间 · 进度条 · 已审 */
export function RecentRow({ a, b, time, prog, onOpen, onSave, onRemove }: {
  a: { name: string; ext: string }; b: { name: string; ext: string }; time: string;
  prog: { total: number; decided: number } | null;
  onOpen: () => void; onSave: () => void; onRemove: () => void;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const has = !!(prog && prog.total);
  const done = has && prog!.decided >= prog!.total;
  return (
    <div className="lib-row recent-row" role="button" tabIndex={0} title={`${a.name}\n→ ${b.name}`} onClick={onOpen} onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen(); } }}>
      <div className="rr-main">
        <div className="rr-files">
          <span className="rr-side"><TypeTag type={a.ext} /><MidName name={a.name} title={false} /></span>
          <span className="rr-arr" aria-label={t('到')}>→</span>
          <span className="rr-side"><TypeTag type={b.ext} /><MidName name={b.name} title={false} /></span>
        </div>
        <div className="rr-meta">
          <span className="rr-time">{time}</span>
          {has
            ? <><span className="rr-bar" aria-hidden="true"><i style={{ width: `${Math.round((prog!.decided / prog!.total) * 100)}%` }} /></span>
                <span className="rr-prog">{done ? t('已审完') : t('已审 {d} / {n}', { d: prog!.decided, n: prog!.total })}</span></>
            : <span className="rr-prog">{t('未开始审阅')}</span>}
        </div>
      </div>
      <button ref={more} type="button" className="btn sm plain icon" aria-label={t('更多')} title={t('更多')} onClick={(e) => { e.stopPropagation(); setMenu(!menu); }}><I.IconMore /></button>
      <Popover anchor={more} open={menu} onClose={() => setMenu(false)} width={260}>
        <div onClick={(e) => e.stopPropagation()}>
          <MenuItem icon={<I.IconPlusDoc />} onClick={() => { setMenu(false); onSave(); }}>{t('存为往来稿')}</MenuItem>
          <MenuItem icon={<I.IconX />} onClick={() => { setMenu(false); onRemove(); }}>{t('从列表移除')}</MenuItem>
        </div>
      </Popover>
    </div>
  );
}
