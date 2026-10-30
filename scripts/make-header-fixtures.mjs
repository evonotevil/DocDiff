// 页眉金额改动的最小夹具（beta.5 评估 F1）：页眉“合同金额120000元”→“198000元”，正文相同。全部虚构。
import { Document, Packer, Paragraph, Header } from 'docx';
import fs from 'node:fs';
import path from 'node:path';
const out = path.join(path.dirname(new URL(import.meta.url).pathname), '../work/review-fixtures');
fs.mkdirSync(out, { recursive: true });
for (const [v, amt] of [[1, '120000'], [2, '198000']]) {
  const doc = new Document({ sections: [{ headers: { default: new Header({ children: [new Paragraph(`合同金额${amt}元`)] }) }, children: [new Paragraph('第一条 本合同为虚构样本。'), new Paragraph('第二条 正文内容相同。')] }] });
  fs.writeFileSync(path.join(out, `header-V${v}.docx`), Buffer.from(await Packer.toBuffer(doc)));
}
console.log('ok', out);
