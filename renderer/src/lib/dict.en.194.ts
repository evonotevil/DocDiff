// 1.9.4 新增文案的英文（术语：Negotiation = 往来稿，Redline = 审阅稿）
export const EN_194: Record<string, string> = {
  // 表单控件
  '淡化 {n}%': 'Fade {n}%',
  // 启动时的“没写进审阅稿”（G6）
  '以后启动时不再提示': 'Don’t show this at startup again',
  // PDF 段落读法更新（G7）
  '这份 PDF 的段落读法更新了，上次的 {n} 个决定对不上。': 'DocDiff now reads paragraphs in this PDF differently. Earlier decisions that no longer match: {n}.',
  '对得上的 {n} 个已经带回。对不上的不会挪到别的条款，这几处请重新看一下。': 'Decisions that still match are back ({n}). The others won’t be moved to other clauses; review those changes again.',
  '对不上的不会挪到别的条款，这几处请重新看一下。': 'They won’t be moved to other clauses; review those changes again.',
  '这份 PDF 的段落读法更新了，上次的 {n} 个决定都已带回。': 'DocDiff now reads paragraphs in this PDF differently. Your earlier decisions are all back ({n}).',
};
