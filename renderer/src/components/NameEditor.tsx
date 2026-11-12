import React, { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import * as I from './icons';
import { Seg, TypeTag } from './ui';
import { draftName } from '../lib/draft/client';

/**
 * 文件名规则编辑器（1.8）：标签（日期 / 对方文件名 / 版本号 / 审阅人）和文字在一个框里，文字随便打、随便删，不自动补“-”；
 * 全部删空也可以（框里灰字写出默认值，用默认规则）。插入按钮只在编辑这个框时出现。下面一行实时预览。
 * 存的仍然是文本规则，如 {date}-{name}-legal，旧的 {name}-定稿 原样兼容；空字符串表示用默认。
 * 1.9.9：标签可以拖动换位置（Alt+← / → 也行），「插入」区的按钮可以直接拖进框里；文字框按实际字宽量宽度。
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
// ---- 1.9.9 拖动：把部件拍平成“一个字 / 一个标签”的序列再挪，挪完重新分组，两侧文字自然合并 ----
type Flat = ({ c: string } | { k: Key; f?: string })[];
const flatten = (ps: Part[]): Flat => ps.flatMap((x): Flat => ('k' in x ? [x] : x.s.split('').map((c) => ({ c }))));
function unflat(fl: Flat): Part[] {
  const out: Part[] = [{ s: '' }];
  for (const x of fl) { if ('c' in x) (out[out.length - 1] as { s: string }).s += x.c; else out.push(x, { s: '' }); }
  return out;
}
/** 部件 i 里第 pos 个字之前，在拍平序列里的位置 */
const flatAt = (ps: Part[], i: number, pos: number) => { let n = 0; for (let j = 0; j < i; j++) n += 'k' in ps[j] ? 1 : (ps[j] as { s: string }).s.length; return n + pos; };
/** 拍平序列里第 n 个标签对应的部件下标 */
const partOfTag = (ps: Part[], n: number) => { let seen = 0; for (let q = 0; q < ps.length; q++) if ('k' in ps[q]) { if (seen === n) return q; seen++; } return -1; };
const tagsBefore = (fl: Flat, at: number) => fl.slice(0, at).filter((x) => !('c' in x)).length;
/** 把部件 j（标签）挪到拍平位置 to（挪动前的坐标）；返回新部件和标签的新下标 */
function moveTag(ps: Part[], j: number, to: number) {
  const fl = flatten(ps); const from = flatAt(ps, j, 0);
  const [tag] = fl.splice(from, 1); const at = to > from ? to - 1 : to; fl.splice(at, 0, tag);
  const out = unflat(fl); return { ps: out, i: partOfTag(out, tagsBefore(fl, at)) };
}
function insertTagAt(ps: Part[], k: Key, to: number) {
  const fl = flatten(ps); fl.splice(to, 0, { k });
  const out = unflat(fl); return { ps: out, i: partOfTag(out, tagsBefore(fl, to)) };
}
let ctx: CanvasRenderingContext2D | null = null;
const measure = (s: string, font: string) => { ctx = ctx || document.createElement('canvas').getContext('2d'); if (!ctx) return s.length * 8; ctx.font = font; return ctx.measureText(s).width; };
type DragSrc = { tag: number } | { add: Key };
type Drop = { i: number; pos: number; x: number; y: number; h: number };

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
  const tags = useRef<(HTMLButtonElement | null)[]>([]);
  const box = useRef<HTMLDivElement>(null);
  // 文字框宽度按真实字体量（挂上后读一次输入框的字体）
  const [font, setFont] = useState('');
  useEffect(() => { const el = inputs.current.find(Boolean); if (el) setFont(getComputedStyle(el).font); }, []);
  const [say, setSay] = useState('');
  // 拖动：按下 → 移动超过 4px 才算拖起；松手放到插入线的位置；Esc 取消
  const press = useRef<{ src: DragSrc; x: number; y: number; label: string } | null>(null);
  const [drag, setDrag] = useState<{ src: DragSrc; x: number; y: number; label: string; drop: Drop | null } | null>(null);
  const dragged = useRef(false);
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
  const focusTag = (i: number) => requestAnimationFrame(() => tags.current[i]?.focus());
  /** 指针下最近的落点：文字框里两个字之间（开头、结尾也算） */
  const dropAt = (cx: number, cy: number): Drop | null => {
    const b = box.current?.getBoundingClientRect();
    if (!b || cx < b.left - 12 || cx > b.right + 12 || cy < b.top - 12 || cy > b.bottom + 12) return null;
    let best: Drop | null = null, bd = Infinity;
    parts.forEach((p, i) => {
      if ('k' in p) return;
      const el = inputs.current[i]; if (!el) return;
      const r = el.getBoundingClientRect(), f = font || getComputedStyle(el).font;
      for (let pos = 0; pos <= p.s.length; pos++) {
        const x = r.left + 1 + (pos ? measure(p.s.slice(0, pos), f) : 0), y = r.top + r.height / 2;
        const d = Math.abs(x - cx) + Math.abs(y - cy) * 3;
        if (d < bd) { bd = d; best = { i, pos, x: x - b.left, y: r.top - b.top + 2, h: r.height - 4 }; }
      }
    });
    return best;
  };
  const finish = (d: NonNullable<typeof drag>) => {
    if (!d.drop) return;
    const to = flatAt(parts, d.drop.i, d.drop.pos);
    const res = 'tag' in d.src ? moveTag(parts, d.src.tag, to) : insertTagAt(parts, d.src.add, to);
    caret.current = null; setMenu(null); commit(res.ps); focusTag(res.i);
  };
  useEffect(() => {
    if (!drag && !press.current) return;
    const move = (e: PointerEvent) => {
      const p = press.current; if (!p) return;
      if (!drag && Math.hypot(e.clientX - p.x, e.clientY - p.y) < 4) return;
      dragged.current = true;
      setDrag({ src: p.src, label: p.label, x: e.clientX, y: e.clientY, drop: dropAt(e.clientX, e.clientY) });
    };
    const up = () => { const d = drag; press.current = null; setDrag(null); if (d) finish(d); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag) { e.preventDefault(); e.stopPropagation(); press.current = null; setDrag(null); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key, true); };
  });
  const [, kick] = useState(0);
  const startPress = (e: React.PointerEvent, src: DragSrc, label: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.x')) return;
    dragged.current = false; press.current = { src, label, x: e.clientX, y: e.clientY }; kick((n) => n + 1);
  };
  /** 拖完松手时浏览器还会补一个 click，吞掉它 */
  const eatClick = () => { if (dragged.current) { dragged.current = false; return true; } return false; };
  const nudge = (i: number, dir: -1 | 1) => {
    const fl = flatten(parts), from = flatAt(parts, i, 0);
    let to = dir > 0 ? fl.length : 0;
    if (dir > 0) { for (let q = from + 1; q < fl.length; q++) if (!('c' in fl[q])) { to = q + 1; break; } }
    else { for (let q = from - 1; q >= 0; q--) if (!('c' in fl[q])) { to = q; break; } }
    if (to === from || to === from + 1) return;
    const res = moveTag(parts, i, to);
    commit(res.ps); focusTag(res.i);
    const n = res.ps.slice(0, res.i).filter((x) => 'k' in x).length + 1;
    setSay(t('已移到第 {n} 个', { n }));
  };
  const setFmt = (i: number, f?: string) => { const ps = parts.slice(); ps[i] = { k: 'date', f }; commit(ps); };
  const preview = draftName(pattern, sample, '', vars);
  const human = parse(fallback).map((x) => ('k' in x ? t(LABEL[x.k]) : x.s)).join('');
  const wrap = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrap} className={`field name-ed ${active ? 'active' : ''}`} onFocus={() => setActive(true)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node)) { setActive(false); setMenu(null); } }}>
      <div className="name-head"><label htmlFor={`${id}-0`}>{label}</label>{value.trim() && <button type="button" className="btn sm plain" onClick={() => { caret.current = null; setMenu(null); onChange(''); }}>{t('恢复默认')}</button>}</div>
      <div ref={box} className={`name-box ${draft ? '' : 'empty'}${drag ? ' dragging' : ''}`} data-ph={t('留空则用默认：{d}', { d: human })} onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); const el = inputs.current[parts.length - 1]; el?.focus(); } }}>
        {parts.map((p, i) => 'k' in p ? (
          <button key={i} ref={(el) => { tags.current[i] = el; }} type="button" className={`name-tag ${menu === i ? 'on' : ''}${drag && 'tag' in drag.src && drag.src.tag === i ? ' lifted' : ''}`} aria-expanded={p.k === 'date' ? menu === i : undefined}
            onPointerDown={(e) => startPress(e, { tag: i }, t(LABEL[p.k]))}
            onClick={() => { if (eatClick()) return; if (p.k === 'date') setMenu(menu === i ? null : i); }}
            onKeyDown={(e) => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); nudge(i, e.key === 'ArrowLeft' ? -1 : 1); } }}
            title={p.k === 'date' ? t('点击切换日期格式，拖动换位置') : t('拖动换位置')} aria-label={t(LABEL[p.k])} aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight">
            {t(LABEL[p.k])}{p.k === 'date' && <I.IconDown />}
            <span className="x" role="button" aria-label={t('移除这个标签')} title={t('移除这个标签')} onClick={(e) => { e.stopPropagation(); removeTag(i); }}><I.IconX /></span>
          </button>
        ) : (
          <input key={i} id={`${id}-${i}`} ref={(el) => { inputs.current[i] = el; }} className="name-txt" value={p.s} spellCheck={false}
            style={{ width: p.s ? (font ? Math.ceil(measure(p.s, font)) + 3 : `calc(${Array.from(p.s).reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 1.9 : 1), 0)}ch + 4px)`) : (i === 0 || i === parts.length - 1 ? 2 : 6) }}
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
        {drag?.drop && <span className="name-drop" style={{ left: drag.drop.x - 1, top: drag.drop.y, height: drag.drop.h }} aria-hidden />}
      </div>
      {drag && <span className="name-tag ghost" style={{ left: drag.x + 8, top: drag.y - 14 }} aria-hidden>{drag.label}</span>}
      <span className="sr-only" aria-live="polite">{say}</span>
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
          <button key={k} type="button" className="btn sm" title={t('点击插在光标处，或拖到框里')} onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => startPress(e, { add: k }, t(LABEL[k]))} onClick={() => { if (!eatClick()) insert(k); }}><I.IconPlusDoc />{t(LABEL[k])}</button>
        ))}
      </div>}
      <div className="name-pre"><span className="cap">{t('预览')}</span><TypeTag type="docx" /><span className="pv" title={preview}>{preview}</span></div>
    </div>
  );
}
