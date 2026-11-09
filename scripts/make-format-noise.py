# 1.9.3（F13）回归夹具：同样的 24 段文字，B 整体换了字体和字号（像另存 / 转换出来的），只有一处改了天数。
# 用法：python3 scripts/make-format-noise.py [输出目录，默认 work/format-noise] → fmt-A.docx / fmt-B.docx
# 内容全部是虚构的占位文字。
import os, sys
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'format-noise')
os.makedirs(OUT, exist_ok=True)
paras = [f'第{i}条 双方应当按照本合同约定履行各自义务，任何一方不得擅自变更或者解除合同，另有约定的除外。' for i in range(1, 25)]

def make(path, font, size, edit=False):
    d = Document()
    for i, s in enumerate(paras):
        if edit and i == 5: s = s.replace('履行各自义务', '在十五日内履行各自义务')
        r = d.add_paragraph().add_run(s)
        r.font.name = font; r.font.size = Pt(size)
        r._element.rPr.rFonts.set(qn('w:eastAsia'), font)
    d.save(path)

make(os.path.join(OUT, 'fmt-A.docx'), 'SimSun', 12)
make(os.path.join(OUT, 'fmt-B.docx'), 'DengXian', 11, edit=True)
print('ok', OUT)
