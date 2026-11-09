# 性能回归用的合成 PDF 夹具（1.9.2）：两份各 120 页的虚构文档，B 每 7 页改一段、每 13 页加一段。
# 用法：python3 scripts/make-perf-pdf-120.py [输出目录，默认 work/perf-pdf120] → pdf120-A.pdf / pdf120-B.pdf
# 内容全部是随机拼出来的占位词。
import os, sys, random
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'perf-pdf120')
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('F', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', subfontIndex=0))
random.seed(20261109)
words = '甲方 乙方 服务 期限 费用 保密 违约 责任 通知 争议 解决 适用 法律 附件 生效 终止 数据 安全 交付 验收 支付 发票'.split()
line = lambda: ''.join(random.choice(words) for _ in range(random.randint(8, 14))) + '。'
pages = [[line() for _ in range(30)] for _ in range(120)]

def draw(path, edit):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    for i, lines in enumerate(pages):
        ls = list(lines)
        if edit and i % 7 == 3: ls[5] = ls[5].replace('甲方', '甲方及其关联方', 1) or ls[5] + '（已修改）'
        if edit and i % 13 == 6: ls.insert(10, '新增：双方另行签署补充协议。')
        c.setFont('F', 14); c.drawString(60, h - 60, f'第 {i + 1} 页 · 合成样本')
        c.setFont('F', 10.5)
        for k, s in enumerate(ls[:31]): c.drawString(60, h - 90 - k * 22, s)
        c.showPage()
    c.save()
draw(os.path.join(OUT, 'pdf120-A.pdf'), False); draw(os.path.join(OUT, 'pdf120-B.pdf'), True)
print('ok', OUT)
