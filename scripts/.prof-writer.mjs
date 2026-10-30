import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import fs from 'node:fs';
const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
globalThis.DOMParser = DOMParser;
const X = await import('/home/claude/docdiff/.cache/review-draft.test.mjs');
const io = { parse: (s) => new DOMParser().parseFromString(s, 'application/xml'), serialize: (d) => new XMLSerializer().serializeToString(d) };
const ld = async (s) => { const data = new Uint8Array(fs.readFileSync(`/home/claude/docdiff/work/review-fixtures/huge-${s}.docx`)); return X.parseDocx({ path: 'x', name: 'x', ext: 'docx', size: 0, mtime: 0, birthtime: 0, data }); };
const A = await ld('A'), B = await ld('B');
const bA = X.compareBlocks(A), bB = X.compareBlocks(B);
const res = X.diffDocsSec(bA, bB, { ignoreCase: false, ignoreWhitespace: true, precision: 'word', formatting: true, detectMoves: true, normPunct: false, mergeParas: true });
const plan = X.buildPlan(res, bA, bB);
for (let i = 0; i < 12; i++) {
  const t = performance.now();
  const out = await X.writeReview({ base: B.file.data, plan, decisions: { 1: { v: 'a' }, 2: { v: 'r' } }, mode: 'draft', reviewer: 'x', theirs: 'y', theirsDate: 0, now: 0, io });
  console.log(Math.round(performance.now() - t), JSON.stringify(out.ms));
}
