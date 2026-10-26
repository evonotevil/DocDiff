# 中文矢量 PDF 夹具（混合字体）：
#   正文用嵌入的 TrueType（文泉驿正黑子集，Identity-H + ToUnicode）
#   金额、期限行用不嵌入的 STSong-Light（预置 CMap UniGB-UCS2-H，PDF 里常见的“宋体”写法）
# mix-A/B：只有金额、期限行不同；embed-A/B：全部嵌入、同样的改动（对照组）；mix-A2：与 mix-A 内容相同（误报检查）
import sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.pdfbase.ttfonts import TTFont
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
pdfmetrics.registerFont(TTFont('WQY', '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc', subfontIndex=0))
def lines(changed):
    return [('h', '软件服务协议'), ('p', '第一条 服务内容'), ('p', '乙方向甲方提供数据分析平台的部署、运维及技术支持服务。'),
            ('p', '第二条 费用与支付'),
            ('k', '服务总费用为人民币 198,000 元，一次性支付。' if changed else '服务总费用为人民币 120,000 元，分两期支付。'),
            ('k', '甲方应在合同签订后 15 日内支付首期款项。' if changed else '甲方应在合同签订后 30 日内支付首期款项。'),
            ('p', '第三条 服务期限'),
            ('k', '服务期限为二十四个月，自本协议生效之日起计算。' if changed else '服务期限为十二个月，自本协议生效之日起计算。'),
            ('p', '第四条 保密'), ('p', '双方应对在履行本协议过程中获知的对方信息承担保密义务。')]
def make(path, changed, keyfont):
    c = canvas.Canvas(path, pagesize=A4); y = 780
    for kind, t in lines(changed):
        c.setFont(keyfont if kind == 'k' else 'WQY', 16 if kind == 'h' else 12)
        c.drawString(72, y, t); y -= 26
    c.showPage(); c.save()
d = sys.argv[1]
make(f'{d}/cn-mix-A.pdf', False, 'STSong-Light'); make(f'{d}/cn-mix-B.pdf', True, 'STSong-Light'); make(f'{d}/cn-mix-A2.pdf', False, 'STSong-Light')
make(f'{d}/cn-embed-A.pdf', False, 'WQY'); make(f'{d}/cn-embed-B.pdf', True, 'WQY')
