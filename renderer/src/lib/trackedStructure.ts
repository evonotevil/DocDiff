// 对方 Word 里“结构性”的修订：整行删除（trPr/del）和段落标记删除（pPr/rPr/del）。
// docx.ts（读）和 draft/ooxml.ts 的 acceptExisting（写审阅稿前按“接受”处理）共用这一份判断，
// 两边必须一模一样，否则写回时块对不上（1.9 · QA P1）。
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const isW = (n: Node | null | undefined, local?: string): n is Element => !!n && n.nodeType === 1 && (n as Element).namespaceURI === W && (!local || (n as Element).localName === local);
const kid = (el: Node | null | undefined, local: string): Element | null => {
  if (!el) return null;
  for (let c = el.firstChild; c; c = c.nextSibling) if (isW(c, local)) return c;
  return null;
};
const nextEl = (n: Node): Element | null => { for (let c = n.nextSibling; c; c = c.nextSibling) if (c.nodeType === 1) return c as Element; return null; };

/** 这一行在修订里被整行删除了 */
export const rowDeleted = (tr: Element): boolean => { const pr = kid(tr, 'trPr'); return !!(kid(pr, 'del') || kid(pr, 'moveFrom')); };

/** 段落标记被删除（按“接受”后本段并入下一段） */
export const markDeleted = (p: Element): boolean => { const rPr = kid(kid(p, 'pPr'), 'rPr'); return !!(kid(rPr, 'del') || kid(rPr, 'moveFrom')); };

const CONTENT = new Set(['t', 'tab', 'br', 'cr', 'sym', 'drawing', 'pict', 'object', 'noBreakHyphen', 'softHyphen', 'fldSimple', 'footnoteReference', 'endnoteReference']);
/** 接受全部修订后，这一段里还有没有内容（不算被删的、被移走的） */
export function keptContent(p: Element): boolean {
  const rec = (n: Node): boolean => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (!isW(c)) { if (c.nodeType === 1 && rec(c)) return true; continue; }
      const ln = c.localName;
      if (ln === 'pPr' || ln === 'rPr' || ln === 'del' || ln === 'moveFrom') continue;
      if (CONTENT.has(ln)) return true;
      if (rec(c)) return true;
    }
    return false;
  };
  return rec(p);
}

/**
 * 段落标记被删时怎么处理：
 *  - 'drop'  本段没有保留的内容：整段去掉；
 *  - 'merge' 有内容：并进紧跟着的下一段；
 *  - 'keep'  后面紧跟的不是段落（表格、分节、单元格末尾）或本段带分节符：不动，只当标记没被删。
 */
export function markAction(p: Element): 'drop' | 'merge' | 'keep' | null {
  if (!markDeleted(p)) return null;
  if (kid(kid(p, 'pPr'), 'sectPr')) return 'keep';
  const nx = nextEl(p);
  if (!isW(nx, 'p')) return 'keep';
  return keptContent(p) ? 'merge' : 'drop';
}
