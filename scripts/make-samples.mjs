// 生成内置的“示例合同”两版：首页「用示例合同试一下」用，也是 1.6 回归测试的夹具。
// 内容覆盖：页眉、页脚（页码）、脚注、标题、列表、表格、金额、日期、期限、关键词条款、格式变化。
// 1.9.9 起还有：Word 批注（双方、带回复、落在对方新增的段落上）、图片变化、条款里一段换位置（移动）。
// 用法：node scripts/make-samples.mjs
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, PageNumber,
  FootnoteReferenceRun, Table, TableRow, TableCell, WidthType, LevelFormat,
  CommentRangeStart, CommentRangeEnd, CommentReference, ImageRun,
} from 'docx';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'renderer', 'public', 'samples');
fs.mkdirSync(out, { recursive: true });

const FONT = { eastAsia: 'SimSun', ascii: 'Times New Roman', hAnsi: 'Times New Roman' };
const t = (text, o = {}) => new TextRun({ text, font: FONT, size: 22, ...o });
const p = (children, o = {}) => new Paragraph({ children, spacing: { after: 120, line: 360 }, ...o });
const h = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text, bold: true, size: 26, font: FONT })], spacing: { before: 240, after: 120 } });
const li = (text) => new Paragraph({ children: [t(text)], numbering: { reference: 'dots', level: 0 } });
const cell = (text, bold = false) => new TableCell({ children: [new Paragraph({ children: [t(text, { bold })] })], width: { size: 33, type: WidthType.PERCENTAGE } });

// 批注作者：我方 = 星河科技，对方 = 北辰数据（App 打开示例时把“星河科技法务部”算作我方）
const OURS = '星河科技法务部', THEIRS = '北辰数据法务部';
const D = (d) => new Date(`2026-0${d}T10:00:00Z`);
/** 把一段文字包在批注里 */
const cm = (id, runs) => [new CommentRangeStart(id), ...runs, new CommentRangeEnd(id), new TextRun({ children: [new CommentReference(id)] })];

/** 服务架构示意图（PNG，不依赖字体）：v1 三个方块，v2 多一个“审计”方块 */
function diagram(v2) {
  const W = 360, H = 90, px = Buffer.alloc((W * 3 + 1) * H, 255);
  const box = (x0, c) => { for (let y = 25; y < 65; y++) for (let x = x0; x < x0 + 70; x++) { const i = y * (W * 3 + 1) + 1 + x * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; } };
  const arrow = (x0) => { for (let x = x0; x < x0 + 14; x++) for (let y = 43; y < 47; y++) { const i = y * (W * 3 + 1) + 1 + x * 3; px[i] = px[i + 1] = px[i + 2] = 150; } };
  for (let y = 0; y < H; y++) px[y * (W * 3 + 1)] = 0;
  box(10, [28, 176, 246]); arrow(84); box(100, [88, 204, 2]); arrow(174); box(190, [255, 150, 0]);
  if (v2) { arrow(264); box(280, [206, 130, 255]); }
  const crc = (b) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(px)), chunk('IEND', Buffer.alloc(0))]);
}

function build(v2) {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: v2 ? '软件服务协议（修订版）' : '软件服务协议', bold: true, size: 36, font: FONT })] }),
    p([t('本协议由甲方：'), t('星河科技有限公司', { bold: true }), t(' 与乙方：'), t('北辰数据服务有限公司', { bold: true }), t(`于 2026 年 ${v2 ? 4 : 3} 月 1 日签订。`)]),
    h('第一条 服务内容'),
    p(v2
      ? [t('乙方向甲方提供'), t('数据分析平台', { bold: true }), t('的部署、运维及技术支持服务，'), ...cm(0, [t('服务期限为二十四个月')]), t('。')]
      : [t('乙方向甲方提供数据分析平台的部署、运维及技术支持服务，服务期限为十二个月。')]),
    p([t('服务架构示意：')]),
    p([new ImageRun({ type: 'png', data: diagram(v2), transformation: { width: 360, height: 90 } })]),
    p([t('服务包括以下内容：')]),
    li('平台安装与初始化配置'),
    li(`每${v2 ? '周' : '月'}一次系统巡检`),
    li('7×24 小时故障响应'),
    ...(v2 ? [li('年度安全审计报告')] : []),
    h('第二条 费用与支付'),
    p([t(`服务总费用为人民币 ${v2 ? '198,000' : '120,000'} 元（含税）`), new FootnoteReferenceRun(1), t(`，甲方应在合同签订后 ${v2 ? 15 : 30} 日内支付首期款项。`)]),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({ children: [cell('阶段', true), cell('比例', true), cell('金额（元）', true)] }),
        new TableRow({ children: [cell('首期'), cell('50%'), cell(v2 ? '99,000' : '60,000')] }),
        new TableRow({ children: [cell('尾款'), cell('50%'), cell(v2 ? '99,000' : '60,000')] }),
      ],
    }),
    h('第三条 保密'),
    p([t(`双方应对在履行本协议过程中知悉的对方商业秘密承担保密义务，保密期限为协议终止后${v2 ? '五' : '三'}年。`)]),
    h('第四条 违约责任'),
    p(v2 ? [t('任何一方违约，应向守约方支付违约金，违约金为合同总价的 20%。')] : [t('任何一方违约，应向守约方支付违约金，'), ...cm(0, [t('违约金为合同总价的 10%')]), t('。')]),
    ...(v2 ? [p(cm(2, [t('乙方的累计赔偿责任上限为本协议项下甲方已支付费用的总额。')]))] : []),
    h('第五条 协议解除'),
    p([t(`一方严重违约且在收到书面通知后 ${v2 ? 10 : 15} 日内未纠正的，另一方有权解除本协议。`)]),
    h('第六条 其他'),
    // v2 把“未尽事宜”挪到本条开头（移动）；这一段本身不改，免得和别的修改搅在一起
    ...(v2 ? [p([t('本协议未尽事宜，由双方另行书面协商。')])] : []),
    p([t('本协议自双方签字盖章之日起生效。')]),
    p([t('本协议一式两份，双方各执一份，'), t('具有同等法律效力', { bold: v2 }), t('。')]),
    ...(v2 ? [] : [p([t('本协议未尽事宜，由双方另行书面协商。')])]),
  ];
  return new Document({
    creator: v2 ? '北辰数据法务部' : '星河科技法务部',
    lastModifiedBy: v2 ? '北辰数据法务部' : '星河科技法务部',
    title: '软件服务协议',
    comments: { children: v2 ? [
      { id: 0, author: THEIRS, initials: '北辰', date: D('3-20'), children: [new Paragraph({ children: [new TextRun('延长服务期是为了摊薄部署成本，月单价不变。')] })] },
      { id: 1, author: OURS, initials: '星河', date: D('3-22'), parentId: 0, children: [new Paragraph({ children: [new TextRun('可以接受二十四个月，首期款比例还要再谈。')] })] },
      { id: 2, author: THEIRS, initials: '北辰', date: D('3-20'), children: [new Paragraph({ children: [new TextRun('赔偿上限是我方的标准条款，各家客户一致。')] })] },
    ] : [
      { id: 0, author: OURS, initials: '星河', date: D('2-28'), children: [new Paragraph({ children: [new TextRun('违约金底线 15%，再高需要报业务负责人。')] })] },
    ] },
    numbering: { config: [{ reference: 'dots', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    footnotes: { 1: { children: [new Paragraph({ children: [t(`服务费用含增值税，税率按 ${v2 ? 9 : 6}% 计算。`, { size: 18 })] })] } },
    sections: [{
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t(`星河科技 × 北辰数据 · 软件服务协议${v2 ? '（修订版）' : ''}`, { size: 18, color: '666666' })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [t('第 ', { size: 18 }), new TextRun({ children: [PageNumber.CURRENT], size: 18 }), t(' 页', { size: 18 })] })] }) },
      children,
    }],
  });
}

for (const v2 of [false, true]) {
  const buf = await Packer.toBuffer(build(v2));
  const f = path.join(out, `示例合同_${v2 ? 'v2' : 'v1'}.docx`);
  fs.writeFileSync(f, buf);
  console.log('写入', path.relative(root, f), buf.length, 'bytes');
}
