import React, { useState } from 'react';
import { t } from '../lib/i18n';
import { Modal } from './Modal';
import { Notice } from './Panel';
import * as I from './icons';

export type ExportKind = 'redline' | 'final' | 'report';

export function ExportDialog({ total, undecided, risks, author, setAuthor, reviewer, setReviewer, commentAccepted, setCommentAccepted, hasSections, onExport, onHoldPending, onClose, busy }: {
  total: number; undecided: number; risks: number;
  author: string; setAuthor: (v: string) => void;
  reviewer: string; setReviewer: (v: string) => void;
  commentAccepted: boolean; setCommentAccepted: (v: boolean) => void;
  hasSections: boolean;
  onExport: (k: ExportKind) => void; onHoldPending: () => void; onClose: () => void; busy: boolean;
}) {
  const [kind, setKind] = useState<ExportKind>('redline');
  const opts: [ExportKind, string, string][] = [
    ['redline', t('Word 修订稿 · 带审阅批注'), t('所有差异保持为 Word 修订，你的每个决定是一条批注。给律师或对方，在 Word 里继续逐条接受或拒绝。')],
    ['final', t('Word 审阅后定稿 · 保留记录'), t('接受的写成正文，拒绝的恢复原文，待议的仍是修订；所有批注保留。用来存档或作为下一轮的基础。')],
    ['report', t('比对报告 PDF'), t('需要留意的条款、比对凭证、按条款分组的差异表和每一条的结论，最后附修订全文。')],
  ];
  const blockFinal = kind === 'final' && undecided > 0;
  return (
    <Modal title={t('导出审阅结果')} onClose={onClose} className="export-modal"
      footer={<>
        <button className="btn plain" onClick={onClose}>{t('取消')}</button>
        <button className="btn primary" disabled={busy || blockFinal} onClick={() => onExport(kind)}><I.IconExport />{busy ? t('正在导出…') : t('导出')}</button>
      </>}>
      <div className="exp-opts" role="radiogroup" aria-label={t('导出类型')}>
        {opts.map(([k, title, desc]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`exp-opt ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>
            <span className="r" aria-hidden="true" />
            <b>{title}</b>
            <span className="d">{desc}</span>
          </button>
        ))}
      </div>
      {kind !== 'report' && (
        <>
          <div className="field-row">
            <div className="field grow">
              <label htmlFor="exp-author">{t('修订作者')}</label>
              <input id="exp-author" value={author} onChange={(e) => setAuthor(e.target.value)} />
            </div>
            <div className="field grow">
              <label htmlFor="exp-reviewer">{t('批注署名')}</label>
              <input id="exp-reviewer" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </div>
          </div>
          <label className="check-line">
            <input type="checkbox" checked={commentAccepted} onChange={(e) => setCommentAccepted(e.target.checked)} />
            <span>{t('接受的修订也加批注')}</span>
          </label>
        </>
      )}
      {undecided > 0 && (
        <Notice tone="warn" className="stack" title={t('还有 {n} 处没有处理。', { n: undecided })}
          action={kind === 'final' && <button className="btn sm" onClick={onHoldPending}>{t('把 {n} 处都标为待议', { n: undecided })}</button>}>
          {kind === 'final' ? t('定稿需要先处理完每一处修订。可以回去继续审阅，或者把它们都标为待议（在定稿里保持为修订）。')
            : kind === 'redline' ? t('修订稿中它们保持为修订、不加批注。') : t('报告里显示为“—”。')}
        </Notice>
      )}
      <p className="caption">
        {kind === 'report'
          ? t('共 {n} 处差异{r}。', { n: total, r: risks ? t('，其中 {k} 处需要留意', { k: risks }) : '' })
          : t('导出的 Word 是根据比较内容重新排版的：页面设置、部分编号样式和图片可能与原件不同。') + (hasSections ? ' ' + t('页眉页脚放回 Word 的页眉页脚，脚注列在文末。') : '')}
      </p>
    </Modal>
  );
}
