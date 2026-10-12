import React, { useEffect, useMemo, useState } from 'react';
import type { Sec } from '../lib/model';
import type { DiffResult } from '../lib/engine';
import { t } from '../lib/i18n';

const LABEL: Record<Sec, string> = { header: '页眉', body: '正文', footnote: '脚注', footer: '页脚' };

export interface SecHeadProps { sec: Sec; n: number; open: boolean; onToggle: () => void; span?: boolean }

/** 区段标题条：页眉 / 正文 / 脚注 / 页脚，带差异数，可以折叠 */
export function SecHead({ sec, n, open, onToggle, span }: SecHeadProps) {
  return (
    <div className={`sec-head${span ? ' span' : ''}${n ? ' has' : ''}`} data-sec={sec}>
      <button type="button" className="sec-toggle" aria-expanded={open} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
        <span className={`chev ${open ? 'open' : ''}`} aria-hidden="true">›</span>
        <b>{t(LABEL[sec])}</b>
        <span className="sec-n">{n ? t('{n} 处差异', { n }) : t('无差异')}</span>
      </button>
    </div>
  );
}

/**
 * 文档里有页眉 / 页脚 / 脚注时，在每个区段开头插一条标题。
 * 没有差异的非正文区段默认收起；选中某处变更时自动展开它所在的区段。
 */
export function useSections(res: DiffResult) {
  const info = useMemo(() => {
    const has = res.rows.some((r) => r.sec && r.sec !== 'body');
    const count = new Map<Sec, number>();
    for (const c of res.changes) count.set(c.sec || 'body', (count.get(c.sec || 'body') || 0) + 1);
    const starts = new Map<number, Sec>();
    let prev: Sec | null = null;
    res.rows.forEach((r, i) => { const s = r.sec || 'body'; if (has && s !== prev) { starts.set(i, s); prev = s; } });
    return { has, count, starts };
  }, [res]);
  const [closed, setClosed] = useState<Set<Sec>>(new Set());
  useEffect(() => {
    const c = new Set<Sec>();
    for (const s of info.starts.values()) if (s !== 'body' && !info.count.get(s)) c.add(s);
    setClosed(c);
  }, [info]);
  const toggle = (s: Sec) => setClosed((x) => { const y = new Set(x); y.has(s) ? y.delete(s) : y.add(s); return y; });
  return {
    has: info.has,
    hidden: (s?: Sec) => closed.has(s || 'body'),
    reveal: (s?: Sec) => { const k = s || 'body'; if (closed.has(k)) setClosed((x) => { const y = new Set(x); y.delete(k); return y; }); },
    headAt: (i: number): SecHeadProps | null => {
      const s = info.starts.get(i);
      if (!s) return null;
      return { sec: s, n: info.count.get(s) || 0, open: !closed.has(s), onToggle: () => toggle(s) };
    },
  };
}
