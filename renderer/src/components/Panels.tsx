import React, { useState } from 'react';
import type { Change, ChangeKind } from '../lib/engine';
import type { Risk } from '../lib/insight';
import type { ScopeInfo } from '../lib/scope';
import { t } from '../lib/i18n';
import { riskTag, riskText } from '../lib/describe';
import { short } from './ChangeList';

export const KIND_ORDER: ChangeKind[] = ['del', 'ins', 'mod', 'fmt', 'move'];
const KIND_NAME: Record<ChangeKind, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };
const KIND_HINT: Record<ChangeKind, string> = { del: '删除线', ins: '下划线', mod: '删除线 + 下划线', fmt: '虚线下划线', move: '双线' };

const KIND_ICON: Record<ChangeKind | 'all', React.ReactNode> = {
  all: <path d="M5 6h10M5 10h10M5 14h6" />,
  del: <path d="M5 10h10" />,
  ins: <path d="M5 10h10M10 5v10" />,
  mod: <path d="M12.5 4.5l3 3L8 15H5v-3z" />,
  fmt: <path d="M7 4.5h4a2.6 2.6 0 0 1 0 5.2H7zM7 9.7h4.6a2.9 2.9 0 0 1 0 5.8H7z" />,
  move: <path d="M7 4.5v11M4.5 7L7 4.5 9.5 7M13 15.5v-11M10.5 13l2.5 2.5 2.5-2.5" />,
};
const KindIcon = ({ k }: { k: ChangeKind | 'all' }) => (
  <span className={`kind-ic k-${k}`} aria-hidden="true"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">{KIND_ICON[k]}</svg></span>
);

/** 差异概览（1.6.2）：两列三行，彩色图标块 + 大号数字；“全部”一格清除筛选。点一格只看这一类（再点取消）。 */
export function Overview({ stats, filter, setFilter, compact }: { stats: Record<ChangeKind, number>; filter: ChangeKind[]; setFilter: (f: ChangeKind[]) => void; compact?: boolean }) {
  const toggle = (k: ChangeKind) => setFilter(filter.includes(k) ? filter.filter((x) => x !== k) : [...filter, k]);
  const total = KIND_ORDER.reduce((n, k) => n + (stats[k] || 0), 0);
  return (
    <div className={`kinds ${compact ? 'compact' : ''}`} role="group" aria-label={t('按类型筛选')}>
      {!compact && (
        <button type="button" className={`kind-tile k-all ${filter.length ? 'dim' : 'on'}`} aria-pressed={!filter.length} onClick={() => setFilter([])} title={t('显示全部')}>
          <KindIcon k="all" /><span className="kt"><b>{total}</b><span className="lbl">{t('全部')}</span></span>
        </button>
      )}
      {KIND_ORDER.map((k) => (
        <button key={k} type="button" className={`kind-tile k-${k} ${filter.length && !filter.includes(k) ? 'dim' : ''} ${filter.includes(k) ? 'on' : ''}`}
          aria-pressed={filter.includes(k)} disabled={!stats[k]} onClick={() => toggle(k)}
          title={t('{k}：{h}。点一下只看这一类', { k: t(KIND_NAME[k]), h: t(KIND_HINT[k]) })}>
          <KindIcon k={k} /><span className="kt"><b>{stats[k]}</b><span className="lbl">{t(KIND_NAME[k])}</span></span>
        </button>
      ))}
    </div>
  );
}

/** 需要留意：命中金额 / 日期期限 / 关键词规则的变化 */
export function RiskList({ risks, changes, clauses, onSel, sel }: { risks: Risk[]; changes: Map<number, Change>; clauses: Map<number, string | null>; onSel: (id: number) => void; sel: number | null }) {
  const [more, setMore] = useState(false);
  if (!risks.length) return null;
  const LIMIT = 3;
  const shown = more ? risks : risks.slice(0, LIMIT);
  return (
    <>
      <div className="risk-list">
        {shown.map((r) => {
          const c = changes.get(r.cid);
          if (!c) return null;
          const where = c.sec && c.sec !== 'body' ? t(c.sec === 'header' ? '页眉' : c.sec === 'footer' ? '页脚' : '脚注') : clauses.get(c.id) ?? t('开头部分');
          return (
            <button key={r.cid} type="button" className={`risk-item ${sel === r.cid ? 'on' : ''}`} onClick={() => onSel(r.cid)}>
              <span className="ri-body">
                <span className="ri-top"><span className="ri-where">{where}</span><span className="tag hold">{riskTag(r)}</span></span>
                <span className="ri-line"><span className="ri-diff">{c.kind === 'mod' ? <><del>{short(c.before, 24)}</del><span className="arrow">→</span><ins>{short(c.after, 24)}</ins></> : c.kind === 'del' ? <del>{short(c.before, 40)}</del> : <ins>{short(c.after, 40)}</ins>}</span>
                <span className="ri-what">{riskText(r)}</span></span>
              </span>
            </button>
          );
        })}
      </div>
      {risks.length > LIMIT && <button className="btn sm plain block" onClick={() => setMore((v) => !v)}>{more ? t('收起') : t('展开其余 {n} 条', { n: risks.length - LIMIT })}</button>}
    </>
  );
}

/** 比较范围与条件（比对凭证） */
export function ScopeBody({ scope }: { scope: ScopeInfo }) {
  return (
      <dl className="scope">
        <dt>{t('已比较')}</dt><dd>{scope.compared.join(t('、'))}</dd>
        {scope.notCompared.length > 0 && <><dt>{t('未比较')}</dt><dd>{scope.notCompared.map((x) => <span key={x} className="scope-item">{x}</span>)}</dd></>}
        <dt>{t('条件')}</dt><dd>{scope.conditions.join(t('；'))}</dd>
        <dt>{t('对齐')}</dt><dd>{scope.alignment}</dd>
        {scope.files.map((f) => <React.Fragment key={f.side}><dt>{f.side}</dt><dd><span className="mono" title={f.sha}>SHA-256 {f.sha.slice(0, 12)}…</span><br />{f.source}</dd></React.Fragment>)}
      </dl>
  );
}
