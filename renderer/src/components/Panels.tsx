import React from 'react';
import type { ChangeKind } from '../lib/engine';
import type { ScopeInfo } from '../lib/scope';
import { t } from '../lib/i18n';

export const KIND_ORDER: ChangeKind[] = ['del', 'ins', 'mod', 'fmt', 'move'];
const KIND_NAME: Record<ChangeKind, string> = { del: '删除', ins: '新增', mod: '修改', fmt: '格式', move: '移动' };
const KIND_HINT: Record<ChangeKind, string> = { del: '删除线', ins: '下划线', mod: '删除线 + 下划线', fmt: '虚线下划线', move: '双线' };

export type Filter = 'all' | ChangeKind | 'risk';

/**
 * 筛选片（规范 3.0）：检查器里唯一的筛选入口，同时就是“差异概览”的计数。
 * 一次只选一个；再点一次已选的回到“全部”。数量为 0 的类别不出现。
 */
export function FilterChips({ stats, risks, value, onChange }: { stats: Record<ChangeKind, number>; risks: number; value: Filter; onChange: (f: Filter) => void }) {
  const total = KIND_ORDER.reduce((n, k) => n + (stats[k] || 0), 0);
  const pick = (f: Filter) => onChange(value === f ? 'all' : f);
  return (
    <div className="chips" role="group" aria-label={t('按类型筛选')}>
      <button type="button" className={`fchip ${value === 'all' ? 'on' : ''}`} aria-pressed={value === 'all'} onClick={() => onChange('all')}>{t('全部')}<span className="c">{total}</span></button>
      {KIND_ORDER.filter((k) => stats[k]).map((k) => (
        <button key={k} type="button" className={`fchip ${value === k ? 'on' : ''}`} aria-pressed={value === k} onClick={() => pick(k)}
          title={t('{k}：{h}。点一下只看这一类', { k: t(KIND_NAME[k]), h: t(KIND_HINT[k]) })}>
          <span className={`fdot k-${k}`} aria-hidden="true" />{t(KIND_NAME[k])}<span className="c">{stats[k]}</span>
        </button>
      ))}
      {risks > 0 && (
        <button type="button" className={`fchip warn ${value === 'risk' ? 'on' : ''}`} aria-pressed={value === 'risk'} onClick={() => pick('risk')}
          title={t('命中金额、期限、关键词规则的差异')}>
          <span className="fwarn" aria-hidden="true">⚠</span>{t('需要留意')}<span className="c">{risks}</span>
        </button>
      )}
    </div>
  );
}

/** 一行话说清这次比较了什么（检查器底部的“比较范围”摘要） */
export function scopeLine(scope: ScopeInfo): string {
  const base = `${scope.compared.join(t('、'))} · ${scope.conditions[0]}`;
  return scope.notCompared.length ? t('{c} · {n} 项未比较', { c: base, n: scope.notCompared.length }) : base;
}

/** 比较范围（比对凭证）：弹出层里的完整内容 */
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
