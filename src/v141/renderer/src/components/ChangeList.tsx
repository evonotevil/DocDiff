import React, { useEffect, useRef } from 'react';
import type { Change } from '../lib/engine';
import { t } from '../lib/i18n';

const KINDS: Record<string, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };
export const KIND_LABEL = new Proxy({} as Record<string, string>, { get: (_, k: string) => t(KINDS[k] || k) });

export function ChangeList({ changes, sel, onSel, decisions }: { changes: Change[]; sel: number | null; onSel: (id: number) => void; decisions?: Record<number, 'a' | 'r'> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sel == null) return;
    ref.current?.querySelector(`[data-chg="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);
  if (!changes.length) return null;
  return (
    <div className="chg-list" ref={ref}>
      {changes.map((c, i) => (
        <button key={c.id} data-chg={c.id} className={`chg ${c.id === sel ? 'on' : ''} ${decisions?.[c.id] ? 'done-' + decisions[c.id] : ''}`} onClick={() => onSel(c.id)}>
          <span className={`chg-dot ${c.kind}`}>{i + 1}</span>
          <span className="chg-body">
            <span className="chg-top">
              <span className={`tag ${c.kind}`}>{KIND_LABEL[c.kind]}</span>
              {decisions?.[c.id] && <span className={`dec ${decisions[c.id]}`}>{decisions[c.id] === 'a' ? `✓ ${t('已接受')}` : `✕ ${t('已拒绝')}`}</span>}
            </span>
            <span className="txt">
              {c.kind === 'fmt' ? (<>{short(c.before) || t('（段落）')}<em>{c.note}</em></>) :
               c.kind === 'move' ? (<>{short(c.before)}<em>{t('整段换了位置')}</em></>) :
               c.kind === 'mod' ? (<><del>{short(c.before, 50)}</del><span className="arrow">→</span><ins>{short(c.after, 50)}</ins></>) :
               c.kind === 'del' ? <del>{short(c.before)}</del> : <ins>{short(c.after)}</ins>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function short(s: string, n = 90) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** 生成可粘贴的 Markdown 摘要 */
export function changesMarkdown(changes: Change[], a: string, b: string, stats: Record<string, number>): string {
  const lines = [
    t('## 文档差异摘要'),
    ``,
    `- ${t('原始文档')}：${a}`,
    `- ${t('修改后文档')}：${b}`,
    t('- 共 {n} 处：删除 {del}、新增 {ins}、修改 {mod}', { n: changes.length, del: stats.del, ins: stats.ins, mod: stats.mod }) + (stats.fmt ? t('、格式 {n}', { n: stats.fmt }) : '') + (stats.move ? t('、移动 {n}', { n: stats.move }) : ''),
    ``,
  ];
  changes.forEach((c, i) => {
    const q = (s: string) => `“${short(s, 200)}”`;
    const body = c.kind === 'mod' ? `${q(c.before)} → ${q(c.after)}` : c.kind === 'del' ? q(c.before) : c.kind === 'ins' ? q(c.after) : c.kind === 'fmt' ? `${q(c.before)}（${c.note}）` : `${q(c.before)}（${t('整段移动')}）`;
    lines.push(`${i + 1}. **${KIND_LABEL[c.kind]}**：${body}`);
  });
  return lines.join('\n');
}
