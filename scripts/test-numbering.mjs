// 1.9.1 F2：条款编号和 Word 一致。合成 DOCX（完全虚构），用真实的 parseDocx 解析，逐条和 Word 的显示对照。
// 用法：node scripts/test-numbering.mjs   （同时把夹具写到 work/numbering-fixtures/，方便在 Word 里打开对照）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.cache', 'numbering.docx.mjs');
await esbuild.build({ stdin: { contents: "export { parseDocx } from './renderer/src/lib/docx';", resolveDir: root, loader: 'ts' }, bundle: true, format: 'esm', platform: 'node', target: 'node20', outfile: out, logLevel: 'warning' });
{
  const El = Object.getPrototypeOf(new DOMParser().parseFromString('<a><b/></a>', 'application/xml').documentElement);
  const nextEl = (n) => { while (n && n.nodeType !== 1) n = n.nextSibling; return n || null; };
  Object.defineProperty(El, 'firstElementChild', { get() { return nextEl(this.firstChild); } });
  Object.defineProperty(El, 'nextElementSibling', { get() { return nextEl(this.nextSibling); } });
  globalThis.DOMParser = DOMParser;
}
const { parseDocx } = await import('file://' + out);
const FIX = path.join(root, 'work/numbering-fixtures');
fs.mkdirSync(FIX, { recursive: true });

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const lvl = (il, fmt, text, start = 1) => `<w:lvl w:ilvl="${il}"><w:start w:val="${start}"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/></w:lvl>`;
const abs = (id, lvls) => `<w:abstractNum w:abstractNumId="${id}">${lvls.join('')}</w:abstractNum>`;
const num = (id, a, over = '') => `<w:num w:numId="${id}"><w:abstractNumId w:val="${a}"/>${over}</w:num>`;
const p = (text, { style, numId, ilvl } = {}) => {
  const ppr = [style ? `<w:pStyle w:val="${style}"/>` : '', numId !== undefined ? `<w:numPr>${ilvl !== undefined ? `<w:ilvl w:val="${ilvl}"/>` : ''}<w:numId w:val="${numId}"/></w:numPr>` : ''].join('');
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
};
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;
async function make(name, numbering, body) {
  const z = new JSZip();
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  z.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  z.file('word/styles.xml', STYLES);
  z.file('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>${numbering}</w:numbering>`);
  z.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr/></w:body></w:document>`);
  const data = await z.generateAsync({ type: 'uint8array' });
  fs.writeFileSync(path.join(FIX, name + '.docx'), data);
  const m = await parseDocx({ path: '/x/' + name + '.docx', name: name + '.docx', ext: 'docx', size: data.length, mtime: 1, birthtime: 1, data });
  return m.blocks.map((b) => `${b.kind}|${b.marker ?? ''}|${b.runs.map((r) => r.t).join('')}`);
}
const CLAUSE = abs(0, [lvl(0, 'decimal', '%1.'), lvl(1, 'decimal', '%1.%2'), lvl(2, 'lowerLetter', '(%3)')]);

test('标题带编号 + 多级条款（9.5 不再变成 1.36）', async () => {
  const body = [];
  for (let s = 1; s <= 10; s++) {
    body.push(p(`Section ${s}`, { style: 'Heading1' }));
    const n = s === 9 ? 5 : 2;
    for (let c = 1; c <= n; c++) body.push(p(`Clause ${s}-${c}`, { numId: 1, ilvl: 1 }));
  }
  body.push(p('Sub a', { numId: 1, ilvl: 2 }), p('Sub b', { numId: 1, ilvl: 2 }));
  const got = await make('heading-multilevel', CLAUSE + num(1, 0), body);
  assert.equal(got[0], 'h|1.|Section 1');
  assert.equal(got[1], 'li|1.1|Clause 1-1');
  const at = (t) => got.find((x) => x.endsWith('|' + t));
  assert.equal(at('Clause 9-5'), 'li|9.5|Clause 9-5');
  assert.equal(at('Section 10'), 'h|10.|Section 10');
  assert.equal(at('Clause 10-2'), 'li|10.2|Clause 10-2');
  assert.equal(at('Sub a'), 'li|(a)|Sub a');
  assert.equal(at('Sub b'), 'li|(b)|Sub b');
});

test('从 5 开始（w:start）', async () => {
  const got = await make('start-5', abs(1, [lvl(0, 'decimal', '%1.', 5)]) + num(2, 1), [p('A', { numId: 2, ilvl: 0 }), p('B', { numId: 2, ilvl: 0 }), p('C', { numId: 2, ilvl: 0 })]);
  assert.deepEqual(got, ['li|5.|A', 'li|6.|B', 'li|7.|C']);
});

test('中途重新起编（lvlOverride / startOverride）', async () => {
  const n = abs(2, [lvl(0, 'decimal', '%1)')]) + num(3, 2) + num(4, 2, '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride>');
  const got = await make('restart', n, [p('A', { numId: 3, ilvl: 0 }), p('B', { numId: 3, ilvl: 0 }), p('C', { numId: 3, ilvl: 0 }), p('mid'), p('D', { numId: 4, ilvl: 0 }), p('E', { numId: 4, ilvl: 0 })]);
  assert.deepEqual(got, ['li|1)|A', 'li|2)|B', 'li|3)|C', 'p||mid', 'li|1)|D', 'li|2)|E']);
});

test('两个列表共用编号定义：接着数', async () => {
  const n = abs(3, [lvl(0, 'decimal', '%1.')]) + num(5, 3) + num(6, 3);
  const got = await make('shared-abstract', n, [p('A', { numId: 5, ilvl: 0 }), p('B', { numId: 5, ilvl: 0 }), p('mid'), p('C', { numId: 6, ilvl: 0 }), p('D', { numId: 6, ilvl: 0 })]);
  assert.deepEqual(got, ['li|1.|A', 'li|2.|B', 'p||mid', 'li|3.|C', 'li|4.|D']);
});

test('lvlOverride 里整级重新定义（从 3 开始，罗马数字）', async () => {
  const n = abs(4, [lvl(0, 'decimal', '%1.')]) + num(7, 4, `<w:lvlOverride w:ilvl="0">${lvl(0, 'upperRoman', '%1.', 3)}</w:lvlOverride>`);
  const got = await make('override-lvl', n, [p('A', { numId: 7, ilvl: 0 }), p('B', { numId: 7, ilvl: 0 })]);
  assert.deepEqual(got, ['li|III.|A', 'li|IV.|B']);
});

test('项目符号、numId 0、没编号的标题不受影响', async () => {
  const n = abs(5, [lvl(0, 'bullet', '•')]) + num(8, 5) + CLAUSE + num(1, 0);
  const got = await make('bullets', n, [p('A', { numId: 8, ilvl: 0 }), p('Plain heading', { style: 'Heading2' }), p('No number', { style: 'Heading1', numId: 0 }), p('Sec', { style: 'Heading1' })]);
  assert.deepEqual(got, ['li|•|A', 'h||Plain heading', 'h||No number', 'h|1.|Sec']);
});
