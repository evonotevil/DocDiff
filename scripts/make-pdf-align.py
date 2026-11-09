# 1.9.3 PDF 段落对齐排查用的合成夹具：同一份虚构合同，按不同版式导出，只有一处改了一个词。
# 用法：python3 scripts/make-pdf-align.py [输出目录，默认 work/pdf-align]
# 输出 base.pdf（10.5pt、单倍行距、正文宽 450）和一组变体，每个变体都在第 6 段把“三十日”改成“十五日”：
#   same      版式完全一样（对照组）
#   size12    字号 12pt（行宽不变，换行位置变）
#   lead15    1.5 倍行距（行距约 2 倍字号）
#   lead2     2 倍行距
#   narrow    正文宽 380（换行位置变）
#   indent    首行缩进两个字
#   pagebreak 页面更矮，段落跨页的位置变了
#   spacing0  段与段之间没有额外段距
import os, sys, random
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'pdf-align')
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('F', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', subfontIndex=0))
random.seed(193)
W = '甲方 乙方 服务 期限 费用 保密 违约 责任 通知 争议 解决 适用 法律 附件 生效 终止 数据 安全 交付 验收 支付 发票'.split()
paras = []
for i in range(14):
    s = '，'.join(''.join(random.choice(W) for _ in range(random.randint(4, 7))) for _ in range(random.randint(4, 7))) + '。'
    if i == 5: s = '乙方应在收到通知后三十日内完成整改，' + s
    paras.append(f'第{i + 1}条 ' + s)

def wrap(text, size, width, first_indent=0):
    lines, cur, w = [], '', first_indent
    for ch in text:
        cw = stringWidth(ch, 'F', size)
        if w + cw > width and cur:
            lines.append(cur); cur, w = '', 0
        cur += ch; w += cw
    if cur: lines.append(cur)
    return lines

def make(name, size=10.5, lead=1.2, width=450, indent=0, page_h=842, para_gap=None, edit=False):
    c = canvas.Canvas(os.path.join(OUT, name + '.pdf'), pagesize=(595, page_h))
    top = page_h - 72; y = top
    gap = size * 0.8 if para_gap is None else para_gap
    for i, p in enumerate(paras):
        if edit and i == 5: p = p.replace('三十日', '十五日')
        ls = wrap(p, size, width, indent * size)
        for j, l in enumerate(ls):
            if y < 72: c.showPage(); y = top
            c.setFont('F', size); c.drawString(72 + (indent * size if j == 0 else 0), y, l)
            y -= size * lead
        y -= gap
    c.save()

LONG = os.environ.get('LONG') == '1'
if LONG:  # 长段落（每段 6–9 行）+ 组合变体，更像真实合同
    random.seed(1931)
    paras[:] = []
    for i in range(10):
        s = '，'.join(''.join(random.choice(W) for _ in range(random.randint(4, 7))) for _ in range(random.randint(14, 20))) + '。'
        if i == 5: s = '乙方应在收到通知后三十日内完成整改，' + s
        paras.append(f'第{i + 1}条 ' + s)
    make('base')
    make('lead15', lead=2.0, edit=True)
    make('lead15narrow', lead=2.0, width=380, edit=True)
    make('size12lead15', size=12, lead=2.0, edit=True)
    make('spacing0', para_gap=0, edit=True)
    make('spacing0lead15', para_gap=0, lead=2.0, edit=True)
    make('lead14', lead=1.7, edit=True)
    print('ok long', OUT); sys.exit(0)
make('base')
make('same', edit=True)
make('size12', size=12, edit=True)
make('lead15', lead=2.0, edit=True)
make('lead2', lead=2.6, edit=True)
make('narrow', width=380, edit=True)
make('indent', indent=2, edit=True)
make('pagebreak', page_h=520, edit=True)
make('spacing0', para_gap=0, edit=True)
print('ok', OUT)
