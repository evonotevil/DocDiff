import React, { useEffect, useRef } from 'react';
import type { Change } from '../lib/engine';

export const KIND_LABEL: Record<string, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };

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
              {decisions?.[c.id] && <span className={`dec ${decisions[c.id]}`}>{decisions[c.id] === 'a' ? '✓ 已接受' : '✕ 已拒绝'}</span>}
            </span>
            <span className="txt">
              {c.kind === 'fmt' ? (<>{short(c.before) || '（段落）'}<em>{c.note}</em></>) :
               c.kind === 'move' ? (<>{short(c.before)}<em>整段换了位置</em></>) :
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
    `## 文档差异摘要`,
    ``,
    `- 原始文档：${a}`,
    `- 修改后文档：${b}`,
    `- 共 ${changes.length} 处：删除 ${stats.del}、新增 ${stats.ins}、修改 ${stats.mod}${stats.fmt ? `、格式 ${stats.fmt}` : ''}${stats.move ? `、移动 ${stats.move}` : ''}`,
    ``,
  ];
  changes.forEach((c, i) => {
    const q = (s: string) => `“${short(s, 200)}”`;
    const body = c.kind === 'mod' ? `${q(c.before)} → ${q(c.after)}` : c.kind === 'del' ? q(c.before) : c.kind === 'ins' ? q(c.after) : c.kind === 'fmt' ? `${q(c.before)}（${c.note}）` : `${q(c.before)}（整段移动）`;
    lines.push(`${i + 1}. **${KIND_LABEL[c.kind]}**：${body}`);
  });
  return lines.join('\n');
}
