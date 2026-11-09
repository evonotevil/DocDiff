# 性能回归用的合成 Word 夹具（1.9.2）：一对约 3,000 段的虚构合同，B 相对 A 有几百处改动。
# 用法：python3 scripts/make-perf-review-3000.py [输出目录，默认 work/perf-3000] → perf3000-A.docx / perf3000-B.docx / perf3000-C.docx
# C 是对方在 B 上的第二次修改（往来稿 V3 用），每 13 段改一处，各章都有。
# 内容全部是随机拼出来的占位词，不含任何真实文件内容。
import os, sys, random
from docx import Document

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'perf-3000')
os.makedirs(OUT, exist_ok=True)
random.seed(20261109)
words = '甲方 乙方 服务 期限 费用 保密 违约 责任 通知 争议 解决 适用 法律 附件 生效 终止 数据 安全 交付 验收 支付 发票 税费 知识产权 许可'.split()
def sent(k):
    return '，'.join(''.join(random.choice(words) for _ in range(random.randint(3, 6))) for _ in range(k)) + '。'

A, B, C = Document(), Document(), Document()
paras = 0
i = 0
while paras < 3000:
    i += 1
    if i % 25 == 1:
        h = f'第{i // 25 + 1}章 条款'
        A.add_heading(h, level=1); B.add_heading(h, level=1); C.add_heading(h, level=1); paras += 1
        continue
    a = sent(random.randint(2, 5))
    if i % 7 == 0: b = a.replace('，', '，并且', 1)
    elif i % 11 == 0: b = sent(3)
    else: b = a
    if i % 37 != 0: A.add_paragraph(a)
    if i % 41 != 0:
        B.add_paragraph(b)
        C.add_paragraph(b.replace('，', '，同时', 1) if i % 13 == 5 else b)
    paras += 1
A.save(os.path.join(OUT, 'perf3000-A.docx')); B.save(os.path.join(OUT, 'perf3000-B.docx')); C.save(os.path.join(OUT, 'perf3000-C.docx'))
print('ok', OUT, paras)
