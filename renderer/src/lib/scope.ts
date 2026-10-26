// “比对凭证”：每个结果都要说清楚比的是什么、比了哪些、用什么条件、把握多大。
// 屏幕上的“比较范围”卡、复制摘要、比对报告 PDF 共用这一份。
import type { DocModel } from './model';
import { fmtBytes, fmtDate } from './model';
import type { DiffOptions, DiffResult } from './engine';
import { t } from './i18n';

export interface ScopeInfo {
  files: { side: string; name: string; size: string; sha: string; mtime: string; source: string }[];
  compared: string[];
  notCompared: string[];
  conditions: string[];
  alignment: string;
  degraded: boolean;
}

const source = (d: DocModel) =>
  d.type === 'docx' ? t('Word 原文') : d.type === 'pdf' ? t('PDF 版面推断') : d.file.path ? t('纯文本') : t('粘贴的文字');

/** 页码列表：3、7、12 … 共 n 页 */
export function pageList(pages: number[]): string {
  const p = [...pages].sort((a, b) => a - b);
  return p.length > 6 ? t('{a} 等 {n} 页', { a: p.slice(0, 5).join(t('、')), n: p.length }) : p.join(t('、'));
}

export function scopeInfo(A: DocModel, B: DocModel, o: DiffOptions, res: DiffResult | null): ScopeInfo {
  const both = [A, B];
  const found = (k: 'header' | 'footer' | 'footnote') => both.some((d) => d.secInfo?.[k] === 'found');
  const compared = [t('正文'), t('表格'), t('列表')];
  if (found('header')) compared.push(t('页眉'));
  if (found('footer')) compared.push(t('页脚'));
  if (found('footnote')) compared.push(t('脚注'));

  const notCompared: string[] = [];
  const comments = Math.max(...both.map((d) => parseInt(d.meta['批注数量'] || '0', 10) || 0));
  if (comments) notCompared.push(t('批注（{n} 条）', { n: comments }));
  const hasImg = both.some((d) => d.blocks.some((b) => (b.cells ? b.cells.flat() : b.runs).some((r) => r.img)));
  if (hasImg) notCompared.push(t('图片内容（只比较图片是否被替换）'));
  if (both.some((d) => /^是/.test(d.meta['包含修订标记'] || ''))) notCompared.push(t('原文件里的修订标记（按“全部接受”后的内容比较）'));
  if (both.some((d) => d.type === 'pdf' && d.secInfo?.header === 'unknown')) notCompared.push(t('单页 PDF 无法识别页眉页脚，按正文比较'));
  if (both.some((d) => d.type === 'pdf' && d.secInfo?.footnote !== 'found') && both.some((d) => d.secInfo?.footnote === 'found')) notCompared.push(t('PDF 一侧没有识别到脚注，脚注可能留在正文里'));
  if (both.some((d) => d.secInfo?.pageNumbersDropped)) notCompared.push(t('页码'));
  // 读不出来的文字（1.7.4）：字体解析失败或没有字符映射，这些内容不在比较里
  both.forEach((d, i) => { if (d.readIssues) notCompared.push(t('{s}第 {p} 页有 {n} 段文字没能读出', { s: t(i ? '修改后文档' : '原始文档'), p: pageList(d.readIssues.pages), n: d.readIssues.runs })); });
  if (!o.formatting) notCompared.push(t('格式（加粗、字号、颜色等）'));

  const conditions = [
    t(o.precision === 'char' ? '按字符比较' : '按词比较'),
    o.ignoreWhitespace ? t('忽略空白差异') : t('空白差异也算'),
    o.ignoreCase ? t('忽略大小写') : t('区分大小写'),
    o.normPunct ? t('全角 / 半角标点视为相同') : t('区分全角 / 半角标点'),
    o.detectMoves ? t('检测移动的段落') : t('不检测移动'),
    o.formatting ? t('检测格式变化') : t('不检测格式变化'),
  ];

  const deg = res?.degraded;
  const alignment = !deg ? t('精确对齐')
    : deg.pairFallback ? t('简化对齐：两份文档差异太大，段落按位置粗配，对应关系可能不准')
    : t('简化对齐：差异区段过大，没有识别段落的拆分与合并');

  const files = both.map((d, i) => ({
    side: t(i ? '修改后文档' : '原始文档'),
    name: d.file.name,
    size: fmtBytes(d.file.size),
    sha: d.sha256 || '',
    mtime: d.file.mtime ? fmtDate(d.file.mtime) : '',
    source: source(d),
  }));
  return { files, compared, notCompared, conditions, alignment, degraded: !!deg };
}
