import React, { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Seg, TypeTag } from './ui';
import { draftName } from '../lib/draft/client';

/**
 * 文件名规则编辑器（1.8）：标签（日期 / 对方文件名 / 版本号 / 审阅人）和文字在一个框里，文字随便打、随便删，不自动补“-”；
 * 全部删空也可以（框里灰字写出默认值，用默认规则）。插入按钮只在编辑这个框时出现。下面一行实时预览。
 * 存的仍然是文本规则，如 {date}-{name}-legal，旧的 {name}-定稿 原样兼容；空字符串表示用默认。
 */
type Key = 'name' | 'date' | 'ver' | 'who';
type Part = { k: Key; f?: string } | { s: string };
const TOKEN = /\{(name|date|ver|who)(?::([^}]*))?\}/g;
const LABEL: Record<Key, string> = { date: '日期', name: '对方文件名', ver: '版本号', who: '审阅人' };
const DASH = 'YYYY-MM-DD';

/** 拆成 文字, 标签, 文字, 标签, …, 文字（文字可以是空的），这样每两个标签之间、开头和结尾都有一个可以打字的地方 */
function parse(p: string): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of p.matchAll(TOKEN)) {
    out.push({ s: p.slice(last, m.index) });
    out.push({ k: m[1] as Key, f: m[2] });
    last = m.index! + m[0].length;
  }
  out.push({ s: p.slice(last) });
  return out;
}
const join = (ps: Part[]) => ps.map((x) => ('k' in x ? `{${x.k}${x.f ? ':' + x.f : ''}}` : x.s.replace(/[{}]/g, ''))).join('');

export function NameEditor({ id, label, value, fallback, sample, vars, onChange }: {
  id: string; label: string; value: string; fallback: string; sample: string;
  vars: { ver?: string; who?: string }; onChange: (v: string) => void;
}) {
  // 框里显示的是本地草稿：删空时不会马上弹回默认值
  const [draft, setDraft] = useState(value || fallback);
  const sent = useRef(value);
  useEffect(() => { if (value !== sent.current) { sent.current = value; setDraft(value || fallback); } }, [value, fallback]);
  const [active, setActive] = useState(false);
  const pattern = draft.trim() || fallback;
  const parts = parse(draft);
  const caret = useRef<{ i: number; pos: number } | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const [menu, setMenu] = useState<number | null>(null);
  const commit = (ps: Part[], focus?: { i: number; pos: number }) => {
    const v = join(ps);
    setDraft(v);
    const out = !v.trim() || v === fallback ? '' : v;
    sent.current = out;
    onChange(out);
    if (focus) requestAnimationFrame(() => { const el = inputs.current[focus.i]; if (el) { el.focus(); el.setSelectionRange(focus.pos, focus.pos); } });
  };
  const setText = (i: number, s: string) => { const ps = parts.slice(); ps[i] = { s }; commit(ps); };
  const removeTag = (i: number) => {
    // 标签 i 两侧的文字合并成一段
    const a = (parts[i - 1] as { s: string }).s, b = (parts[i + 1] as { s: string }).s;
    const ps = [...parts.slice(0, i - 1), { s: a + b }, ...parts.slice(i + 2)];
    commit(ps, { i: i - 1, pos: a.length });
  };
  const insert = (k: Key) => {
    // 插在光标所在的位置（没有光标就加在最后），不自动补“-”，分隔符由用户自己打
    const at = caret.current && parts[caret.current.i] && !('k' in parts[caret.current.i]) ? caret.current : { i: parts.length - 1, pos: (parts[parts.length - 1] as { s: string }).s.length };
    const s = (parts[at.i] as { s: string }).s;
    const ps: Part[] = [...parts.slice(0, at.i), { s: s.slice(0, at.pos) }, { k }, { s: s.slice(at.pos) }, ...parts.slice(at.i + 1)];
    commit(ps, { i: at.i + 2, pos: 0 });
  };
  const setFmt = (i: number, f?: string) => { const ps = parts.slice(); ps[i] = { k: 'date', f }; commit(ps); };
  const preview = draftName(pattern, sample, '', vars);
  const human = parse(fallback).map((x) => ('k' in x ? t(LABEL[x.k]) : x.s)).join('');
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrap} className={`field name-ed ${active ? 'active' : ''}`} onFocus={() => setActive(true)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) { setActive(false); setMenu(null); } }}>
      <div className="name-head"><label htmlFor={`${id}-0`}>{label}</label>{value.trim() && <button type="button" className="btn sm plain" onClick={() => { caret.current = null; setMenu(null); onChange(''); }}>{t('恢复默认')}</button>}</div>
      <div className={`name-box ${draft ? '' : 'empty'}`} data-ph={t('留空则用默认：{d}', { d: human })} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); const el = inputs.current[parts.length - 1]; el?.focus(); } }}>
        {parts.map((p, i) => 'k' in p ? (
          <button key={i} type="button" className={`name-tag ${menu === i ? 'on' : ''}`} aria-expanded={p.k === 'date' ? menu === i : undefined}
            onClick={() => (p.k === 'date' ? setMenu(menu === i ? null : i) : undefined)}
            title={p.k === 'date' ? t('点击切换日期格式') : undefined} aria-label={t(LABEL[p.k])}>
            {t(LABEL[p.k])}{p.k === 'date' && <I.IconDown />}
            <span className="x" role="button" aria-label={t('移除这个标签')} title={t('移除这个标签')} onClick={(e) => { e.stopPropagation(); removeTag(i); }}><I.IconX /></span>
          </button>
        ) : (
          <input key={i} id={`${id}-${i}`} ref={(el) => { inputs.current[i] = el; }} className="name-txt" value={p.s} spellCheck={false}
            style={{ width: p.s ? `calc(${Array.from(p.s).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1.9 : 1), 0)}ch + 4px)` : (i === 0 || i === parts.length - 1 ? 2 : 6) }}
            aria-label={t('文件名里的文字')}
            onChange={(e) => setText(i, e.target.value)}
            onSelect={(e) => { caret.current = { i, pos: (e.target as HTMLInputElement).selectionStart || 0 }; }}
            onFocus={(e) => { caret.current = { i, pos: e.target.selectionStart || 0 }; }}
            onKeyUp={(e) => { caret.current = { i, pos: e.currentTarget.selectionStart || 0 }; }}
            onClick={(e) => { caret.current = { i, pos: e.currentTarget.selectionStart || 0 }; }}
            onBlur={(e) => { caret.current = { i, pos: e.target.selectionStart || 0 }; }}
            onKeyDown={(e) => {
              const el = e.currentTarget;
              if (e.key === 'Backspace' && el.selectionStart === 0 && el.selectionEnd === 0 && i > 0) { e.preventDefault(); removeTag(i - 1); }
              else if (e.key === 'ArrowLeft' && el.selectionStart === 0 && i > 0) { e.preventDefault(); const p2 = inputs.current[i - 2]; if (p2) { p2.focus(); const n = p2.value.length; p2.setSelectionRange(n, n); } }
              else if (e.key === 'ArrowRight' && el.selectionStart === el.value.length && i < parts.length - 1) { e.preventDefault(); const p2 = inputs.current[i + 2]; if (p2) { p2.focus(); p2.setSelectionRange(0, 0); } }
            }} />
        ))}
      </div>
      {menu !== null && parts[menu] && 'k' in parts[menu] && (
        <div className="name-fmt">
          <span className="cap">{t('日期格式')}</span>
          <Seg value={(parts[menu] as { f?: string }).f === DASH ? 'dash' : 'ymd'} label={t('日期格式')}
            onChange={(x) => setFmt(menu, x === 'dash' ? DASH : undefined)} options={[['ymd', '20261030'], ['dash', '2026-10-30']]} />
        </div>
      )}
      {active && <div className="name-ins">
        <span className="cap">{t('插入')}</span>
        {(['date', 'name', 'ver', 'who'] as Key[]).map((k) => (
          <button key={k} type="button" className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(k)}><I.IconPlusDoc />{t(LABEL[k])}</button>
        ))}
      </div>}
      <div className="name-pre"><span className="cap">{t('预览')}</span><TypeTag type="docx" /><span className="pv" title={preview}>{preview}</span></div>
    </div>
  );
}
