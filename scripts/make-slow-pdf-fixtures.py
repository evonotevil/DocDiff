# 合成 PDF 夹具：两份 14 页、页数相同的虚构文档，B 在每页插入大量新段落，少量段落有修改。
# 用来复现“十几页 PDF、数百处段落级差异、绝大多数为新增”时的卡顿。内容全部为虚构占位文本。
# 用法：python3 scripts/make-slow-pdf-fixtures.py work/fixtures  → slow-A.pdf / slow-B.pdf
import os, sys, random
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

FONT = '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
pdfmetrics.registerFont(TTFont('F', FONT, subfontIndex=0))
random.seed(20261027)
PAGES = 14
WORDS = ['示例条款', '占位内容', '虚构单位', '甲方代表', '乙方代表', '服务事项', '交付节点', '验收标准', '保密义务', '违约责任',
         '争议解决', '通知方式', '附件说明', '履约期间', '变更程序', '费用结算', '质量要求', '知识产权', '不可抗力', '其他约定']

def sentence(k):
    return '，'.join(random.choice(WORDS) + random.choice(['应当', '可以', '不得', '需要']) + random.choice(WORDS) for _ in range(k)) + '。'

def para(tag):
    return f'{tag} ' + ''.join(sentence(random.randint(2, 4)) for _ in range(random.randint(1, 3)))

# A：每页 14 段；B：同样的 14 段，段间插入新段落（每页约 24 段新增），另有少量修改
base = [[para(f'第{p + 1}.{i + 1}条') for i in range(14)] for p in range(PAGES)]
pages_a, pages_b = [], []
mods = 0
for p, paras in enumerate(base):
    pages_a.append(paras)
    out = []
    for i, t in enumerate(paras):
        if p % 3 == 1 and i == 5:
            t = t.replace('应当', '必须', 1); mods += 1     # 少量修改
        out.append(t)
        for j in range(2 if i < 10 else 1):
            out.append(para(f'补充{p + 1}.{i + 1}.{j + 1}'))   # 新增段落
    pages_b.append(out)

def wrap(c, text, size, width):
    lines, cur = [], ''
    for ch in text:
        if c.stringWidth(cur + ch, 'F', size) > width:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur: lines.append(cur)
    return lines

def make(path, pages, size, lead, gap):
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle('Synthetic Document'); c.setAuthor('fixture'); c.setSubject('placeholder')
    W, H = A4
    for p, paras in enumerate(pages):
        c.setFont('F', 9); c.drawString(72, H - 40, '虚构示例文档 · 仅用于性能测试')
        y = H - 72
        for t in paras:
            for ln in wrap(c, t, size, W - 144):
                c.setFont('F', size); c.drawString(72, y, ln); y -= lead
            y -= gap
        c.setFont('F', 9); c.drawCentredString(W / 2, 30, f'第 {p + 1} 页 共 {len(pages)} 页')
        c.showPage()
    c.save()

d = sys.argv[1] if len(sys.argv) > 1 else 'work/fixtures'
os.makedirs(d, exist_ok=True)
# A 段落少、字号行距大；B 段落多、字号小，保证两份都是 14 页
make(f'{d}/slow-A.pdf', pages_a, 10.5, 15, 8)
make(f'{d}/slow-B.pdf', pages_b, 6.2, 7.6, 1.6)
print(f'A: {sum(map(len, pages_a))} 段，B: {sum(map(len, pages_b))} 段，修改 {mods} 段')
