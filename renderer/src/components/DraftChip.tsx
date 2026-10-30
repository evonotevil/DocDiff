import React, { useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Popover } from './Popover';
import { Modal } from './Modal';
import { Notice } from './Panel';
import { Opt, Switch } from './ui';
import type { DraftState, DraftSync } from '../lib/draft/client';
import { baseOf, dirOf, draftName } from '../lib/draft/client';
import type { Reason } from '../lib/draft/ooxml';

const api = (window as any).api || {};

/** 审阅稿状态片（1.8）：工具栏右侧、导出左边。第一次做出决定后才出现 */
const TONE: Record<DraftState['s'], 'ok' | 'warn' | 'err' | 'busy'> = {
  none: 'ok', saving: 'busy', saved: 'ok', locked: 'warn', modified: 'err', gone: 'err', nowrite: 'err', error: 'err',
};
export const REASON: Record<Reason, string> = {
  section: '页眉、页脚或脚注里的修改暂不写入',
  mismatch: '对方文件和比较时读到的内容对不上',
  field: '在域（自动编号、日期等）里',
  textbox: '在文本框里',
  image: '涉及图片，没法还原',
  cell: '表格的列数或单元格边界对不上',
  place: '这个位置放不下（表格内外交错）',
  range: '位置对不上',
};
const hm = (ms?: number) => { if (!ms) return ''; const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function DraftChip({ state, sync, bPath, narrow, decided, pending, finalPattern, onJump, flash }: {
  state: DraftState; sync: DraftSync; bPath: string; narrow: boolean;
  /** 已决定的处数、未决定或待议的处数 */
  decided: number; pending: number;
  finalPattern: string;
  onJump: (cid: number) => void;
  flash: (m: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [final, setFinal] = useState(false);
  if (state.s === 'none') return null;
  const tone = TONE[state.s];
  const un = state.unwritten || [];
  // 正常时片上只写“审阅稿”（状态看圆点、悬停和弹出层），省出工具栏宽度；出问题时才把状态写在片上
  const quiet = state.s === 'saving' || (state.s === 'saved' && !(state.unwritten || []).length);
  const label = state.s === 'saving' ? t('审阅稿 · 保存中')
    : state.s === 'saved' ? (un.length ? t('审阅稿 · {n} 处没写进', { n: un.length }) : t('审阅稿 · 已保存'))
    : state.s === 'locked' ? t('Word 正在用审阅稿')
    : state.s === 'modified' ? t('审阅稿被改过')
    : state.s === 'gone' ? t('审阅稿不见了')
    : state.s === 'nowrite' ? t('审阅稿写不进')
    : t('审阅稿没保存');
  const dotTone = state.s === 'saved' && un.length ? 'warn' : tone;
  const name = state.path ? baseOf(state.path) : '';
  const sameDir = state.path && dirOf(state.path) === dirOf(bPath);
  return (
    <>
      <button ref={ref} type="button" className={`btn draft-chip ${narrow ? 'narrow' : ''}`} data-ms={state.ms ?? ''} data-parts={state.parts ? JSON.stringify(state.parts) : ''} onClick={() => setOpen(!open)} aria-expanded={open}
        title={state.s === 'saved' ? t('{f} · {t} 已保存', { f: name, t: hm(state.at) }) : label} aria-label={label}>
        <span className={`ddot ${dotTone}`} aria-hidden="true" />
        {!narrow && <span className="lbl">{quiet ? t('审阅稿') : label}</span>}
        <I.IconDown />
      </button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={340} title={<><span className={`ddot ${dotTone}`} aria-hidden="true" />{t('审阅稿')}</>}>
        <div className="draft-pop">
          {state.path && (
            <button type="button" className="draft-file" onClick={() => api.reveal?.(state.path)} title={t('在文件夹中显示')}>
              <I.FileGlyph type="docx" size={22} /><span className="nm">{name}</span>
            </button>
          )}
          <p className="cap">{sameDir ? t('和对方文件在同一个文件夹 · 对方原文件不动') : state.path ? t('在 {d}', { d: dirOf(state.path) }) : ''}</p>
          {state.s === 'saved' && <p className="cap strong">{t('已写入 {n} 处决定 · {t} 保存', { n: decided, t: hm(state.at) })}</p>}
          {state.s === 'saving' && <p className="cap strong">{t('正在写入…')}</p>}
          {state.s === 'saved' && state.prior > 0 && <p className="cap">{t('对方文件里原有的 {n} 处修订已按“接受”处理。', { n: state.prior })}</p>}
          {state.s === 'locked' && <Notice tone="warn" title={t('Word 正在打开这份审阅稿')}>{t('决定先记在 DocDiff 里，关掉 Word 后自动补写，不会丢。')}</Notice>}
          {state.s === 'modified' && <Notice tone="err" title={t('审阅稿在 DocDiff 之外被改过')}>{t('为了不覆盖那些改动，已暂停写入。你的决定都还在。')}</Notice>}
          {state.s === 'gone' && <Notice tone="err" title={t('审阅稿被移走或删除了')}>{t('你的决定都还在，可以重新生成一份。')}</Notice>}
          {state.s === 'nowrite' && <Notice tone="err" title={t('对方文件所在的文件夹写不进去')}>{t('选一个文件夹放审阅稿，之后都写到那里。')}</Notice>}
          {state.s === 'error' && <Notice tone="err" title={t('没能保存审阅稿')}>{/verify failed|split changed/.test(state.error || '') ? t('这份文件的结构比较特殊，审阅稿没写进去。结论都保存在 DocDiff 里。') : state.error}</Notice>}
          {un.length > 0 && (
            <div className="draft-un">
              <Notice tone="warn" title={t('有 {n} 处没写进去', { n: un.length })}>{t('这些结论仍保存在 DocDiff 里，审阅稿里保持对方的写法。')}</Notice>
              <ul>
                {un.slice(0, 50).map((u) => (
                  <li key={u.cid}><button type="button" className="menu-item" onClick={() => { setOpen(false); onJump(u.cid); }}>
                    <span className="n">{t('第 {i} 处', { i: u.cid })}</span><span className="r">{t(REASON[u.reason])}</span>
                  </button></li>
                ))}
              </ul>
            </div>
          )}
          <p className="cap">{t('接受 → 落定；拒绝 → 以你的名义改回；未决定 / 待议 → 保留为对方的修订；待议和备注 → 批注')}</p>
          <div className="acts">
            {state.s === 'modified' && <><button type="button" className="btn sm" onClick={() => { setOpen(false); sync.saveAsNew(); }}>{t('另存为新审阅稿')}</button><button type="button" className="btn sm" onClick={() => api.openExternalFile?.(state.path)}>{t('用 Word 打开')}</button></>}
            {state.s === 'gone' && <button type="button" className="btn sm" onClick={() => { setOpen(false); sync.saveAsNew(); }}>{t('重新生成')}</button>}
            {state.s === 'nowrite' && <button type="button" className="btn sm" onClick={() => sync.chooseFolder(t('选择放审阅稿的文件夹'))}>{t('换个文件夹…')}</button>}
            {state.s === 'error' && <button type="button" className="btn sm" onClick={() => sync.update((sync as any).decisions)}>{t('重试')}</button>}
            {(state.s === 'saved' || state.s === 'locked') && state.path && <button type="button" className="btn sm" onClick={() => api.reveal?.(state.path)}>{t('在文件夹中显示')}</button>}
            <button type="button" className="btn sm primary" onClick={() => { setOpen(false); setFinal(true); }}>{t('生成定稿…')}</button>
          </div>
        </div>
      </Popover>
      {final && <FinalDialog sync={sync} bPath={bPath} pending={pending} pattern={finalPattern} onClose={() => setFinal(false)} flash={flash} />}
    </>
  );
}

function FinalDialog({ sync, bPath, pending, pattern, onClose, flash }: { sync: DraftSync; bPath: string; pending: number; pattern: string; onClose: () => void; flash: (m: string) => void }) {
  const [pend, setPend] = useState<'b' | 'a'>('b');
  const [keepCm, setKeepCm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => {
    setBusy(true); setErr('');
    try {
      const p = await sync.makeFinal({ pending: pend, keepComments: keepCm, pattern });
      onClose();
      flash(t('已生成定稿：{f}', { f: baseOf(p) }));
      api.reveal?.(p);
    } catch (e: any) {
      setErr(String(e?.message) === 'nowrite' ? t('对方文件所在的文件夹写不进去') : String(e?.message || e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={t('生成定稿')} onClose={onClose} className="final-dlg"
      footer={<><button type="button" className="btn" onClick={onClose}>{t('取消')}</button><button type="button" className="btn primary" disabled={busy} onClick={go}>{busy ? t('正在生成…') : t('生成定稿')}</button></>}>
      <p>{t('把接受的修订落定、拒绝的改回原文、去掉修订标记，另存一份干净的文件。审阅稿本身保留，随时可以回来改。')}</p>
      {pending > 0 && (
        <>
          <Notice tone="warn" title={t('还有 {n} 处未决定或待议', { n: pending })}>{t('定稿里这些地方怎么处理：')}</Notice>
          <div className="choice" role="radiogroup">
            <button type="button" role="radio" aria-checked={pend === 'b'} className={`menu-item ${pend === 'b' ? 'on' : ''}`} onClick={() => setPend('b')}>{pend === 'b' ? <I.IconCheck /> : <span className="sp" />}{t('保持对方的写法')}</button>
            <button type="button" role="radio" aria-checked={pend === 'a'} className={`menu-item ${pend === 'a' ? 'on' : ''}`} onClick={() => setPend('a')}>{pend === 'a' ? <I.IconCheck /> : <span className="sp" />}{t('恢复成原文')}</button>
          </div>
        </>
      )}
      <Opt label={t('保留批注')} hint={t('关掉后，定稿里不带任何批注')}><Switch on={keepCm} onChange={setKeepCm} label={t('保留批注')} /></Opt>
      <p className="cap">{t('将生成：{f} · 和审阅稿同一个文件夹', { f: draftName(pattern, sync.ctx.bName) })}</p>
      {err && <Notice tone="err" title={t('没能生成定稿')}>{err}</Notice>}
    </Modal>
  );
}
