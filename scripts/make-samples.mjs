// 生成内置的“示例合同”两版：首页「用示例合同试一下」用，也是 1.6 回归测试的夹具。
// 内容覆盖：页眉、页脚（页码）、脚注、标题、列表、表格、金额、日期、期限、关键词条款、格式变化。
// 用法：node scripts/make-samples.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Header, Footer, PageNumber,
  FootnoteReferenceRun, Table, TableRow, TableCell, WidthType, LevelFormat,
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

function build(v2) {
  const children = [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [new TextRun({ text: v2 ? '软件服务协议（修订版）' : '软件服务协议', bold: true, size: 36, font: FONT })] }),
    p([t('本协议由甲方：'), t('星河科技有限公司', { bold: true }), t(' 与乙方：'), t('北辰数据服务有限公司', { bold: true }), t(`于 2026 年 ${v2 ? 4 : 3} 月 1 日签订。`)]),
    h('第一条 服务内容'),
    p([t(`乙方向甲方提供数据分析平台的部署、运维及技术支持服务，服务期限为${v2 ? '二十四' : '十二'}个月。`)]),
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
    p([t(`任何一方违约，应向守约方支付违约金，违约金为合同总价的 ${v2 ? 20 : 10}%。`)]),
    ...(v2 ? [p([t('乙方的累计赔偿责任上限为本协议项下甲方已支付费用的总额。')])] : []),
    h('第五条 协议解除'),
    p([t(`一方严重违约且在收到书面通知后 ${v2 ? 10 : 15} 日内未纠正的，另一方有权解除本协议。`)]),
    h('第六条 其他'),
    p([t('本协议自双方签字盖章之日起生效。')]),
    p([t('本协议一式两份，双方各执一份，'), t('具有同等法律效力', { bold: v2 }), t('。')]),
  ];
  return new Document({
    creator: v2 ? '北辰数据法务部' : '星河科技法务部',
    lastModifiedBy: v2 ? '北辰数据法务部' : '星河科技法务部',
    title: '软件服务协议',
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
