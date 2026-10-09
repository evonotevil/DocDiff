// 把引擎产出的"与语言无关的描述"翻成当前语言的文案。
// 引擎本身不再碰 t()，所以切换语言不需要重新比对，只需要重新渲染。
import { t, isEn } from './i18n';
import type { BlockDesc, Change, FmtSig, NoteDesc } from './engine';

const SEP = () => (isEn() ? ', ' : '，');
const dflt = () => t('默认');

/** 'b+;sz:10>12' → '加粗，字号 10 → 12' */
export function fmtText(sig?: FmtSig): string {
  if (!sig) return '';
  const out: string[] = [];
  for (const part of sig.split(';')) {
    if (part === 'b+') out.push(t('加粗'));
    else if (part === 'b-') out.push(t('取消加粗'));
    else if (part === 'i+') out.push(t('倾斜'));
    else if (part === 'i-') out.push(t('取消倾斜'));
    else if (part === 'u+') out.push(t('下划线'));
    else if (part === 'u-') out.push(t('取消下划线'));
    else if (part === 's+') out.push(t('删除线'));
    else if (part === 's-') out.push(t('取消删除线'));
    else if (part === 'hl-') out.push(t('取消突出显示'));
    else if (part.startsWith('hl+')) out.push(t('突出显示 {c}', { c: part.slice(3) }));
    else if (part.startsWith('sz:')) { const [a, b] = part.slice(3).split('>'); out.push(t('字号 {a} → {b}', { a: a || dflt(), b: b || dflt() })); }
    else if (part.startsWith('color:')) { const [a, b] = part.slice(6).split('>'); out.push(t('颜色 {a} → {b}', { a: a || dflt(), b: b || dflt() })); }
    else if (part.startsWith('font:')) { const [a, b] = part.slice(5).split('>'); out.push(t('字体 {a} → {b}', { a: a || dflt(), b: b || dflt() })); }
  }
  return out.join(SEP());
}

const kindText = (id: string) =>
  id.startsWith('h') ? t('标题 {n}', { n: id.slice(1) })
  : id === 'li' ? t('列表项')
  : id === 'tr' ? t('表格行')
  : t('正文');

const alignText = (a: string) =>
  t(a === 'center' ? '居中' : a === 'right' ? '右对齐' : a === 'justify' ? '两端对齐' : '左对齐');

/** 段落右上角那个短标签 */
export function blockTagText(d?: BlockDesc): string {
  if (!d) return '';
  if (d.k === 'merge') return t('段落合并');
  if (d.k === 'split') return t('段落拆分');
  return t('样式变化');
}

/** 悬浮提示里的完整说明 */
export function blockNoteText(d?: BlockDesc): string {
  if (!d) return '';
  switch (d.k) {
    case 'merge': return t('段落合并：{a} 段 → {b} 段', { a: d.a, b: d.b });
    case 'split': return t('段落拆分：{a} 段 → {b} 段', { a: d.a, b: d.b });
    case 'kind': return t('段落样式：{a} → {b}', { a: kindText(d.a), b: kindText(d.b) });
    case 'align': return t('对齐：{a} → {b}', { a: alignText(d.a), b: alignText(d.b) });
  }
}

/** 变更列表里一条变更的附注 */
export function noteText(c?: Pick<Change, 'desc'> | null): string {
  const d: NoteDesc | undefined = c?.desc;
  if (!d) return '';
  if (d.k === 'move') return t('移动到第 {n} 段附近', { n: d.n });
  if (d.k === 'fmt') return fmtText(d.sig);
  return blockNoteText(d);
}
