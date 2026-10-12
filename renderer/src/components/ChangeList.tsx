import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Change } from '../lib/engine';
import type { DecMap } from '../lib/review';
import type { Risk } from '../lib/insight';
import { t } from '../lib/i18n';
import { noteText, riskTag } from '../lib/describe';
import { groupChanges } from '../lib/report';

const KINDS: Record<string, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };
export const KIND_LABEL = new Proxy({} as Record<string, string>, { get: (_, k: string) => t(KINDS[k] || k) });
const VERDICT: Record<string, string> = { a: '已接受', r: '已拒绝', h: '待议' };
const VTONE: Record<string, string> = { a: 'brand', r: 'del', h: 'hold' };
const plain = (c: Change) => (c.kind === 'mod' ? `${short(c.before, 40)} → ${short(c.after, 40)}` : short(c.kind === 'ins' ? c.after : c.before, 80));

const PAGE = 400;
const hhmm = (ts: number) => { const d = new Date(ts); const p = (x: number) => String(x).padStart(2, '0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; };

export function ChangeList({ changes, all, sel, onSel, decisions, clauses, risks, grouped = true }: {
  changes: Change[]; all: Change[]; sel: number | null; onSel: (id: number) => void;
  decisions?: DecMap; clauses: Map<number, string | null>; risks: Map<number, Risk>; grouped?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [changes]);
  const order = useMemo(() => new Map(all.map((c, i) => [c.id, i + 1])), [all]);
  useEffect(() => {
    if (sel == null) return;
    const idx = changes.findIndex((c) => c.id === sel);
    if (idx >= limit) setLimit(Math.ceil((idx + 1) / PAGE) * PAGE);
    // 只滚动列表自己，不要连带把整个右栏滚走
    requestAnimationFrame(() => {
      const list = ref.current;
      const el = list?.querySelector(`[data-chg="${sel}"]`) as HTMLElement | null;
      if (!list || !el) return;
      const lr = list.getBoundingClientRect(), er = el.getBoundingClientRect();
      const head = 30; // 吸顶的分组标题
      if (er.top < lr.top + head) list.scrollTop -= lr.top + head - er.top;
      else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom + 4;
    });
  }, [sel]);
  // 大量重复的同一种改动（例如全文把“违约”换成“赔偿”）先列出来，免得在几千条里翻
  const patterns = useMemo(() => {
    if (changes.length < 300) return [];
    const m = new Map<string, { c: Change; n: number }>();
    for (const c of changes) {
      const k = `${c.kind}|${c.before}|${c.after}`;
      const e = m.get(k);
      if (e) e.n++; else m.set(k, { c, n: 1 });
    }
    return [...m.values()].filter((x) => x.n >= 10).sort((a, b) => b.n - a.n).slice(0, 6);
  }, [changes]);
  const groups = useMemo(() => (grouped ? groupChanges(changes.slice(0, limit), clauses) : [{ title: '', items: changes.slice(0, limit) }]), [changes, clauses, limit, grouped]);
  if (!changes.length) return <div className="chg-empty">{t('没有符合筛选条件的变更')}</div>;
  return (
    <div className="chg-list" ref={ref}>
      {patterns.length > 0 && (
        <div className="chg-patterns">
          <div className="chg-group">{t('重复出现的改动')}</div>
          {patterns.map(({ c, n }) => (
            <button key={c.id} className="chg-pattern" onClick={() => onSel(c.id)}>
              <span className="txt">{c.kind === 'mod' ? <><del>{short(c.before, 20)}</del><span className="arrow">→</span><ins>{short(c.after, 20)}</ins></> : c.kind === 'del' ? <del>{short(c.before, 30)}</del> : <ins>{short(c.after, 30)}</ins>}</span>
              <span className="cnt">×{n}</span>
            </button>
          ))}
        </div>
      )}
      {groups.map((g, gi) => (
        <div className="chg-sect" key={gi + g.title}>
          {g.title && <div className="chg-group" title={g.title}>{g.title}</div>}
          {g.items.map((c) => {
            const d = decisions?.[c.id];
            const risk = risks.get(c.id);
            return (
              <button key={c.id} data-chg={c.id} className={`chg k-${c.kind} ${c.id === sel ? 'on' : ''} ${d?.v ? 'done-' + d.v : ''}`} onClick={() => onSel(c.id)} aria-current={c.id === sel}
                title={`${t('第 {i} 处', { i: order.get(c.id) ?? 0 })} · ${KIND_LABEL[c.kind]}`} aria-label={`${KIND_LABEL[c.kind]}：${plain(c)}`}>
                <span className={`chg-dot k-${c.kind}`} aria-hidden="true">{d?.v === 'a' ? '✓' : d?.v === 'r' ? '✕' : order.get(c.id)}</span>
                <span className="chg-body">
                  <span className="txt">
                    {c.kind === 'fmt' ? (<><em>{noteText(c)}</em>{short(c.before, 60) || t('（段落）')}</>) :
                     c.kind === 'move' ? (<><em>{t('整段换了位置')}</em>{short(c.before, 60)}</>) :
                     c.kind === 'mod' ? (<><del>{short(c.before, 40)}</del><span className="arrow">→</span><ins>{short(c.after, 40)}</ins></>) :
                     c.kind === 'del' ? <del>{short(c.before, 80)}</del> : <ins>{short(c.after, 80)}</ins>}
                  </span>
                  {decisions && (d?.by || d?.note) && d?.v && (
                    <span className="chg-rec">{[d.by, d.at ? hhmm(d.at) : '', d.note].filter(Boolean).join(' · ')}</span>
                  )}
                </span>
                {decisions && d?.v ? <span className={`tag ${VTONE[d.v]}`}>{t(VERDICT[d.v])}</span>
                  : risk ? <span className="tag hold" title={t('需要留意')}>{riskTag(risk)}</span> : null}
              </button>
            );
          })}
        </div>
      ))}
      {changes.length > limit && <button className="btn sm plain block" onClick={() => setLimit((l) => l + PAGE)}>{t('再显示 {n} 处', { n: Math.min(PAGE, changes.length - limit) })}</button>}
    </div>
  );
}

export function short(s: string, n = 90) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}
