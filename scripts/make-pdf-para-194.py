# 1.9.4 PDF 段落重建的合成夹具（全部虚构内容）。输出到 work/pdf-para（或第 1 个参数）。
# 每组夹具都写一份 expected.json：每个 PDF 应该重建出的段落（按阅读顺序），以及和哪个文件比较、应有几处文字修改。
#   python3 scripts/make-pdf-para-194.py [输出目录]
# 组：
#   text   文字完全相同，只改行距（1.0 / 1.5 / 2.0）和栏宽            → 不得报文字增删改
#   mixed  同一页里正文单倍、后半（附件）1.5 倍；第 6 条改一个词        → 1 处修改，段落边界不变
#   cols   同样文字排成双栏                                          → 不得报文字增删改，阅读顺序先左栏后右栏
#   table  每页页眉页脚 + 一张三列表格 + 1.5 倍行距正文；第 6 条改一个词 → 1 处修改；页眉页脚、表格行不并进正文
#   xpage  页面很矮，段落在页中间被截断、下一页接着写（窄栏、12pt）     → 不得报文字增删改，跨页的段落是一段
#   word   python-docx 生成 Word（两端对齐、段前段后、中英混排、1.0 / 1.5 / 2.0 倍行距），LibreOffice 转 PDF
import os, sys, json, random, subprocess, shutil
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'pdf-para')
os.makedirs(OUT, exist_ok=True)
pdfmetrics.registerFont(TTFont('F', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', subfontIndex=0))
W = '甲方 乙方 服务 期限 费用 保密 违约 责任 通知 争议 解决 适用 法律 附件 生效 终止 数据 安全 交付 验收 支付 发票'.split()
expected = {}

def paras(seed, n, lo, hi, edit_at=5):
    random.seed(seed)
    out = []
    for i in range(n):
        s = '，'.join(''.join(random.choice(W) for _ in range(random.randint(4, 7))) for _ in range(random.randint(lo, hi))) + '。'
        if i == edit_at: s = '乙方应在收到通知后三十日内完成整改，' + s
        out.append(f'第{i + 1}条 ' + s)
    return out

def wrap(text, size, width):
    lines, cur, w = [], '', 0
    for ch in text:
        cw = stringWidth(ch, 'F', size)
        if w + cw > width and cur:
            lines.append(cur); cur, w = '', 0
        cur += ch; w += cw
    if cur: lines.append(cur)
    return lines

def make(name, ps, size=10.5, lead=1.2, width=450, page_h=842, gap=None, edit=False, lead_from=None, lead2=None, cols=1, hf=False, table_after=None):
    """lead_from：从第几段起改用 lead2 行距（同一页里混合行距）；cols=2 排成双栏；hf=每页页眉页脚；table_after：在第几段后画一张表"""
    c = canvas.Canvas(os.path.join(OUT, name + '.pdf'), pagesize=(595, page_h))
    top = page_h - 72 - (24 if hf else 0); bottom = 72 + (24 if hf else 0)
    colw = width if cols == 1 else (width - 24) / 2
    x0 = [72, 72 + colw + 24]
    st = {'y': top, 'col': 0, 'page': 1}
    g = size * 0.8 if gap is None else gap
    def deco():
        if hf:
            c.setFont('F', 9); c.drawString(72, page_h - 48, '示例公司 · 服务协议（虚构）'); c.drawString(72, 40, f'第 {st["page"]} 页')
    def newpage():
        c.showPage(); st['page'] += 1; st['y'] = top; st['col'] = 0; deco()
    def nl(h):
        if st['y'] - h < bottom:
            if cols == 2 and st['col'] == 0: st['col'] = 1; st['y'] = top
            else: newpage()
    deco()
    for i, p in enumerate(ps):
        if edit and '三十日' in p: p = p.replace('三十日', '十五日')
        ld = lead2 if (lead_from is not None and i >= lead_from) else lead
        for l in wrap(p, size, colw):
            nl(size * ld)
            c.setFont('F', size); c.drawString(x0[st['col']], st['y'], l)
            st['y'] -= size * ld
        st['y'] -= g
        if table_after is not None and i == table_after:
            rows = [('项目', '金额', '期限'), ('服务费', '十万元', '三十个工作日'), ('保证金', '一万元', '合同期满')]
            for r in rows:
                nl(size * 1.6)
                c.setFont('F', size)
                for k, cell in enumerate(r): c.drawString(72 + k * 150, st['y'], cell)
                st['y'] -= size * 1.6
            st['y'] -= g
    c.save()

def exp(group, name, ps, edit=False, extra=None):
    e = [p.replace('三十日', '十五日') if edit else p for p in ps]
    expected.setdefault(group, {})[name] = e if extra is None else extra(e)

# ---- text：文字相同，只改行距和栏宽 ----
P = paras(1941, 10, 14, 20, edit_at=-1)
for n, kw in [('base', {}), ('lead15', {'lead': 2.0}), ('lead2', {'lead': 2.6}), ('narrow', {'width': 380}), ('lead15narrow', {'lead': 2.0, 'width': 380}), ('lead15size12', {'lead': 2.0, 'size': 12})]:
    make('text-' + n, P, **kw); exp('text', 'text-' + n, P)

# ---- mixed：同页混合行距 ----
P = paras(1942, 12, 8, 14)  # 每段 3–5 行，更像真实合同；2 行以内的短段落在行距交界处会保守地多切一刀（只记为格式，见报告）
make('mixed-A', P); exp('mixed', 'mixed-A', P)
make('mixed-B', P, lead_from=7, lead2=2.0, edit=True); exp('mixed', 'mixed-B', P, edit=True)

# ---- dup：同样的“三十日 → 十五日”出现在第 3 条和第 9 条；第 7 条起 1.5 倍行距（升级测试用：1.9.3 时第 9 条被切碎） ----
P = paras(1947, 12, 8, 14)
P[2] = P[2].replace('第3条 ', '第3条 乙方应在收到通知后三十日内完成整改，')
P[8] = P[8].replace('第9条 ', '第9条 乙方应在收到通知后三十日内完成整改，')
make('dup-A', P); exp('dup', 'dup-A', P)
make('dup-B', P, lead_from=6, lead2=2.0, edit=True); exp('dup', 'dup-B', P, edit=True)

# ---- cols：双栏 ----
P = paras(1943, 10, 4, 8, edit_at=-1)
make('cols-A', P); exp('cols', 'cols-A', P)
make('cols-B', P, cols=2); exp('cols', 'cols-B', P)

# ---- table：页眉页脚 + 表格 + 1.5 倍行距 ----
P = paras(1944, 10, 8, 12)
def with_table(e): return e[:4] + ['项目\t金额\t期限', '服务费\t十万元\t三十个工作日', '保证金\t一万元\t合同期满'] + e[4:]
make('table-A', P, hf=True, table_after=3); exp('table', 'table-A', P, extra=with_table)
make('table-B', P, hf=True, table_after=3, lead=2.0, edit=True); exp('table', 'table-B', P, edit=True, extra=with_table)

# ---- xpage：跨页续段 ----
P = paras(1945, 8, 14, 20, edit_at=-1)
make('xpage-A', P)
make('xpage-B', P, page_h=420, width=380, size=12, lead=2.0); exp('xpage', 'xpage-A', P); exp('xpage', 'xpage-B', P)

# ---- word：Word → PDF（LibreOffice） ----
def make_word():
    import docx
    from docx.shared import Pt
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    random.seed(1946)
    en = 'Service Level Agreement data retention period invoice acceptance confidentiality'.split()
    ps = []
    for i in range(12):
        parts = []
        for _ in range(random.randint(10, 16)):
            parts.append(''.join(random.choice(W) for _ in range(random.randint(3, 6))) + (' ' + ' '.join(random.choice(en) for _ in range(random.randint(1, 3))) + ' ' if random.random() < 0.3 else ''))
        s = '，'.join(parts) + '。'
        if i == 5: s = '乙方应在收到通知后三十日内完成整改，' + s
        ps.append(f'第{i + 1}条 ' + s)
    outs = []
    for name, ls, edit in [('word10', 1.0, False), ('word15', 1.5, False), ('word20', 2.0, False), ('word15e', 1.5, True)]:
        d = docx.Document()
        st = d.styles['Normal']; st.font.size = Pt(10.5); st.font.name = 'Noto Serif CJK SC'
        st.element.rPr.rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia', 'Noto Serif CJK SC')
        for p in ps:
            q = d.add_paragraph(p.replace('三十日', '十五日') if edit else p)
            q.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            q.paragraph_format.line_spacing = ls
            q.paragraph_format.space_before = Pt(3); q.paragraph_format.space_after = Pt(6)
        fn = os.path.join(OUT, name + '.docx'); d.save(fn); outs.append(fn)
        exp('word', name, ps, edit=edit)
    soffice = shutil.which('soffice') or shutil.which('libreoffice')
    if not soffice: print('没有 LibreOffice，跳过 word 组'); return
    prof = 'file://' + os.path.abspath(os.path.join(OUT, '.lo-profile'))
    subprocess.run([soffice, '-env:UserInstallation=' + prof, '--headless', '--convert-to', 'pdf', '--outdir', OUT, *outs], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=240)
make_word()

pairs = [
    # [组, A, B, 期望文字修改数]
    ['text', 'text-base', 'text-lead15', 0], ['text', 'text-base', 'text-lead2', 0], ['text', 'text-base', 'text-narrow', 0],
    ['text', 'text-base', 'text-lead15narrow', 0], ['text', 'text-base', 'text-lead15size12', 0],
    ['mixed', 'mixed-A', 'mixed-B', 1], ['dup', 'dup-A', 'dup-B', 3], ['cols', 'cols-A', 'cols-B', 0], ['table', 'table-A', 'table-B', 1], ['xpage', 'xpage-A', 'xpage-B', 0],
    ['word', 'word10', 'word15', 0], ['word', 'word10', 'word20', 0], ['word', 'word10', 'word15e', 1],
]
json.dump({'paras': expected, 'pairs': pairs}, open(os.path.join(OUT, 'expected.json'), 'w'), ensure_ascii=False, indent=1)
print('ok', OUT)
