import React, { useEffect, useRef, useState } from 'react';
import { getSetting, setSetting } from '../lib/persist';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Popover } from './Popover';
import { Modal } from './Modal';
import { Notice } from './Panel';
import { Seg, MidName, TypeTag } from './ui';
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

export function DraftChip({ state, sync, bPath, narrow, decided, pending, finalPattern, onJump, flash, finalReq = 0, hideTip }: {
  /** 完成页开着时不弹首次提示（完成页已经说明了审阅稿） */
  hideTip?: boolean;
  /** 完成页的“生成定稿…”：数字一变就打开定稿弹窗 */
  finalReq?: number;
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
  useEffect(() => { if (finalReq) setFinal(true); }, [finalReq]);
  // 第一次生成审阅稿时说明一次：决定是自动写进去的，发给对方的就是它
  const [tip, setTip] = useState(false);
  useEffect(() => {
    if (state.s === 'saved' && state.path && !getSetting('draft-tip-seen')) setTip(true);
  }, [state.s, state.path]);
  const closeTip = () => { setTip(false); setSetting('draft-tip-seen', 1); };
  if (state.s === 'none') return null;
  const tone = state.s === 'nowrite' && sync.ctx.noDir ? 'warn' : TONE[state.s];
  const un = state.unwritten || [];
  // 正常时片上只写“审阅稿”（状态看圆点、悬停和弹出层），省出工具栏宽度；出问题时才把状态写在片上
  const quiet = state.s === 'saving' || (state.s === 'saved' && !(state.unwritten || []).length);
  const label = state.s === 'saving' ? t('审阅稿 · 保存中')
    : state.s === 'saved' ? (un.length ? t('审阅稿 · {n} 处没写进', { n: un.length }) : t('审阅稿 · 已保存'))
    : state.s === 'locked' ? t('Word 正在用审阅稿')
    : state.s === 'modified' ? t('审阅稿被改过')
    : state.s === 'gone' ? t('审阅稿不见了')
    : state.s === 'nowrite' ? (sync.ctx.noDir ? t('审阅稿 · 选文件夹') : t('审阅稿写不进'))
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
      <Popover anchor={ref} open={tip && !open && !hideTip} onClose={closeTip} width={320} className="draft-tip" noFocus label={t('决定会自动写进审阅稿')}>
        <div className="tip-b">
          <div className="tip-t">{t('决定会自动写进审阅稿')}</div>
          <div className="file-row"><TypeTag type="docx" /><MidName name={name} /></div>
          <p>{t('每个决定约 0.3 秒内自动写入，不用导出。')}</p>
          <p>{t('对方原文件不动；要发给对方的就是这份。')}</p>
          <div className="acts"><button type="button" className="btn sm" onClick={() => { closeTip(); api.reveal?.(state.path); }}>{t('在文件夹中显示')}</button><button type="button" className="btn sm primary" onClick={closeTip}>{t('知道了')}</button></div>
        </div>
      </Popover>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={340} label={t('审阅稿')} title={<><span className={`ddot ${dotTone}`} aria-hidden="true" />{t('审阅稿')}</>}>
        <div className="draft-pop">
          {state.path && (
            <button type="button" className="draft-file" onClick={() => api.reveal?.(state.path)} title={t('在文件夹中显示')}>
              <TypeTag type="docx" /><MidName name={name} title={false} />
            </button>
          )}
          <p className="cap">{sameDir ? t('和对方文件在同一个文件夹 · 对方原文件不动') : state.path ? t('在 {d}', { d: dirOf(state.path) }) : ''}</p>
          {state.s === 'saved' && <p className="cap strong">{t('已写入 {n} 处决定 · {t} 保存', { n: decided, t: hm(state.at) })}</p>}
          {state.s === 'saving' && <p className="cap strong">{t('正在写入…')}</p>}
          {state.s === 'saved' && state.prior > 0 && <p className="cap">{t('对方文件里原有的 {n} 处修订已按“接受”处理。', { n: state.prior })}</p>}
          {state.s === 'locked' && <Notice tone="warn" title={t('Word 正在打开这份审阅稿')}>{t('决定先记在 DocDiff 里，关掉 Word 后自动补写，不会丢。')}</Notice>}
          {state.s === 'modified' && <Notice tone="err" title={t('审阅稿在 DocDiff 之外被改过')}>{t('为了不覆盖那些改动，已暂停写入。你的决定都还在。')}</Notice>}
          {state.s === 'gone' && <Notice tone="err" title={t('审阅稿被移走或删除了')}>{t('你的决定都还在，可以重新生成一份。')}</Notice>}
          {state.s === 'nowrite' && (sync.ctx.noDir
            ? <Notice tone="warn" title={t('对方的原文件找不到了')}>{t('它可能被挪走或改了名。选一个文件夹放审阅稿，之后都写到那里。')}</Notice>
            : <Notice tone="err" title={t('对方文件所在的文件夹写不进去')}>{t('选一个文件夹放审阅稿，之后都写到那里。')}</Notice>)}
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
            {state.s === 'nowrite' && <button type="button" className="btn sm" onClick={() => sync.chooseFolder(t('选择放审阅稿的文件夹'))}>{sync.ctx.noDir ? t('选择文件夹…') : t('换个文件夹…')}</button>}
            {state.s === 'error' && <button type="button" className="btn sm" onClick={() => sync.update((sync as any).decisions)}>{t('重试')}</button>}
            {(state.s === 'saved' || state.s === 'locked') && state.path && <button type="button" className="btn sm" onClick={() => api.reveal?.(state.path)}>{t('在文件夹中显示')}</button>}
            <button type="button" className="btn sm primary" onClick={() => { setOpen(false); setFinal(true); }}>{t('生成定稿…')}</button>
          </div>
        </div>
      </Popover>
      {final && <FinalDialog sync={sync} bPath={bPath} pending={pending} pattern={finalPattern} onClose={() => setFinal(false)} flash={flash} onJump={onJump} />}
    </>
  );
}

function FinalDialog({ sync, bPath, pending, pattern, onClose, flash, onJump }: { sync: DraftSync; bPath: string; pending: number; pattern: string; onClose: () => void; flash: (m: string) => void; onJump: (cid: number) => void }) {
  const [pend, setPend] = useState<'b' | 'a'>('b');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // 先生成、检查有没有没落实的处；有就停下来列出来，用户确认后才保存（beta.5）
  const [built, setBuilt] = useState<{ pend: 'a' | 'b'; r: Awaited<ReturnType<DraftSync['buildFinal']>> } | null>(null);
  const missed = built && built.pend === pend ? built.r.missed : null;
  const fname = draftName(pattern, sync.ctx.bName, '', sync.vars());
  const save = async (r: Awaited<ReturnType<DraftSync['buildFinal']>>) => {
    const p = await sync.saveFinal(r.out, pattern);
    onClose();
    flash(r.missed.length ? t('已生成定稿：{f}。有 {n} 处没能改回原文，定稿里仍是对方的写法，请在 Word 里核对。', { f: baseOf(p), n: r.missed.length }) : t('已生成定稿：{f}', { f: baseOf(p) }));
    api.reveal?.(p);
  };
  const go = async () => {
    setBusy(true); setErr('');
    try {
      if (missed) { await save(built!.r); return; }
      const r = await sync.buildFinal({ pending: pend });
      if (r.missed.length) { setBuilt({ pend, r }); return; }
      await save(r);
    } catch (e: any) {
      setErr(String(e?.message) === 'nowrite' ? t('对方文件所在的文件夹写不进去') : String(e?.message || e));
    } finally { setBusy(false); }
  };
  return (
    <Modal title={t('生成定稿')} onClose={onClose} className="final-dlg spec"
      footer={<><button type="button" className="btn big" onClick={onClose}>{t('取消')}</button><button type="button" className={`btn big ${missed?.length ? 'red' : 'primary'}`} disabled={busy} onClick={go}>{busy ? t('正在生成…') : missed?.length ? t('仍然生成定稿') : t('生成定稿')}</button></>}>
      <p>{t('一份干净的 Word：接受的改动直接采用，拒绝的改回原文，没有修订标记和批注。审阅稿不受影响。')}</p>
      {pending > 0 && (
        <div className="dlg-field">
          <div className="lbl">{t('还有 {n} 处没有决定（含待议），在定稿里：', { n: pending })}</div>
          <Seg full value={pend} onChange={setPend} label={t('没有决定的处')} options={[['b', t('用对方的改动')], ['a', t('改回我方原文')]]} />
        </div>
      )}
      <div className="dlg-field">
        <div className="lbl">{t('将生成')}</div>
        <div className="file-row"><TypeTag type="docx" /><MidName name={fname} /></div>
        <div className="dlg-hint">{t('和审阅稿放在同一个文件夹 · 命名规则在 设置 · 审阅')}</div>
      </div>
      {missed && missed.length > 0 && (
        <div className="draft-un">
          <Notice tone="err" title={t('有 {n} 处决定没能落实到定稿', { n: missed.length })}>{t('这些处应该改回原文，但写不进去，定稿里仍会是对方的写法。点一处可以回去查看；或者在 Word 里手动改。')}</Notice>
          <ul>
            {missed.slice(0, 50).map((u) => (
              <li key={u.cid}><button type="button" className="menu-item" onClick={() => { onClose(); onJump(u.cid); }}>
                <span className="n">{t('第 {i} 处', { i: u.cid })}</span><span className="r">{t(REASON[u.reason])}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
      {err && <Notice tone="err" title={t('没能生成定稿')}>{err}</Notice>}
    </Modal>
  );
}
