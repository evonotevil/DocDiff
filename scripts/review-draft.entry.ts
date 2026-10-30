// 测试入口：把解析、比较、计划、写入打包给 node 用（scripts/test-review-draft.mjs、自检脚本共用）
export { parseDocx } from '../renderer/src/lib/docx';
export { compareBlocks, blockText } from '../renderer/src/lib/model';
export { diffDocsSec } from '../renderer/src/lib/engine';
export { buildPlan } from '../renderer/src/lib/draft/plan';
export { writeReview, locate, acceptExisting } from '../renderer/src/lib/draft/ooxml';
