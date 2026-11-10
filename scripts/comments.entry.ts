// 1.9.5 批注测试入口：解析、比较、批注定位、审阅稿写入
export { parseDocx } from '../renderer/src/lib/docx';
export { compareBlocks } from '../renderer/src/lib/model';
export { diffDocsSec } from '../renderer/src/lib/engine';
export { buildPlan } from '../renderer/src/lib/draft/plan';
export { writeReview } from '../renderer/src/lib/draft/ooxml';
export { buildThreads, groupOf, internalComments, live, bestFor } from '../renderer/src/lib/comments';
export { rowClauses } from '../renderer/src/lib/insight';
