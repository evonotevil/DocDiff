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

/** 差异概览：五类各一格（数字 + 名称，左侧色条与变更列表一致），点一下只看这一类（再点取消）。 */
export function Overview({ stats, filter, setFilter, compact }: { stats: Record<ChangeKind, number>; filter: ChangeKind[]; setFilter: (f: ChangeKind[]) => void; compact?: boolean }) {
  const toggle = (k: ChangeKind) => setFilter(filter.includes(k) ? filter.filter((x) => x !== k) : [...filter, k]);
  return (
    <div className={`kinds ${compact ? 'compact' : ''}`} role="group" aria-label={t('按类型筛选')}>
      {KIND_ORDER.map((k) => (
        <button key={k} type="button" className={`kind-tile k-${k} ${filter.length && !filter.includes(k) ? 'dim' : ''} ${filter.includes(k) ? 'on' : ''}`}
          aria-pressed={filter.includes(k)} disabled={!stats[k]} onClick={() => toggle(k)}
          title={t('{k}：{h}。点一下只看这一类', { k: t(KIND_NAME[k]), h: t(KIND_HINT[k]) })}>
          <b>{stats[k]}</b>
          <span className="lbl">{t(KIND_NAME[k])}</span>
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
