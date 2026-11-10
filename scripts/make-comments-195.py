# 1.9.5 批注夹具（全部虚构内容）。
# 用法：python3 scripts/make-comments-195.py [输出目录，默认 work/comments-195]
# 生成一对：cm-A.docx（我方稿）/ cm-B.docx（对方稿），以及 cm-plain-B.docx（没有批注的对方稿，对照用）。
# 覆盖：对方批注挂在修订上 + 我方同事回复（commentsExtended 线程）、对方已解决、批注挂在被修订删掉的文字上、
# 只有批注没有修订、对方稿里混着我方内部批注、表格里的批注、跨段批注、我方稿里同事的批注（文字被对方改过 / 没改）。
import sys, os, zipfile

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'work', 'comments-195')
os.makedirs(OUT, exist_ok=True)
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def r(t):
    return f'<w:r><w:t xml:space="preserve">{esc(t)}</w:t></w:r>'


def cs(i):
    return f'<w:commentRangeStart w:id="{i}"/>'


def ce(i):
    return f'<w:commentRangeEnd w:id="{i}"/><w:r><w:commentReference w:id="{i}"/></w:r>'


def dl(t, i=900):
    return f'<w:del w:id="{i}" w:author="虚构对方" w:date="2026-11-01T10:00:00Z"><w:r><w:delText xml:space="preserve">{esc(t)}</w:delText></w:r></w:del>'


def p(*parts, h=False):
    body = ''.join(x if x.startswith('<') else r(x) for x in parts)
    ppr = '<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>' if h else ''
    return f'<w:p>{ppr}{body}</w:p>'


def tbl(rows):
    trs = ''
    for row in rows:
        trs += '<w:tr>' + ''.join(f'<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{c if c.startswith("<w:p") else p(c)}</w:tc>' for c in row) + '</w:tr>'
    return f'<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>{trs}</w:tbl>'


STYLES = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:b/></w:rPr></w:style></w:styles>'''


def build(path, body, comments):
    """comments: [(id, author, initials, date, text, paraId, parentParaId|None, done)]"""
    doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="{W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="{W14}"><w:body>{body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>'
    ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    parts = {}
    if comments:
        cx = ''.join(
            f'<w:comment w:id="{i}" w:author="{esc(a)}" w:initials="{esc(ini)}" w:date="{d}">'
            + ''.join(f'<w:p w14:paraId="{pid if k == len(text.split(chr(10))) - 1 else format(int(pid, 16) + 0x100 + k, "08X")}">{r(line)}</w:p>' for k, line in enumerate(text.split('\n')))
            + '</w:comment>' for (i, a, ini, d, text, pid, par, done) in comments)
        parts['word/comments.xml'] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="{W}" xmlns:w14="{W14}">{cx}</w:comments>'
        ex = ''.join(f'<w15:commentEx w15:paraId="{pid}"' + (f' w15:paraIdParent="{par}"' if par else '') + f' w15:done="{1 if done else 0}"/>' for (i, a, ini, d, text, pid, par, done) in comments)
        parts['word/commentsExtended.xml'] = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w15:commentsEx xmlns:w15="{W15}">{ex}</w15:commentsEx>'
        ct += '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>'
        rels += '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>'
    ct += '</Types>'
    rels += '</Relationships>'
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/_rels/document.xml.rels', rels)
        z.writestr('word/document.xml', doc)
        z.writestr('word/styles.xml', STYLES)
        for k, v in parts.items():
            z.writestr(k, v)


D = '2026-11-08T14:20:00Z'
# ---------- 我方稿（A） ----------
A_BODY = ''.join([
    p('第三条 费用与支付', h=True),
    p('甲方应在收到发票后三十日内支付服务费，逾期每日按未付金额的万分之五支付违约金。'),
    p('第五条 违约责任', h=True),
    p('任何一方违约的，违约金上限为合同总额的百分之十。'),
    p('第七条 保密', h=True),
    p('双方对本合同内容', cs(1), '负有保密义务', ce(1), '，期限为三年。'),
    p('第九条 合同解除', h=True),
    p('经双方协商一致可以解除本合同。乙方可单方解除合同。'),
    p('第十条 付款账户', h=True),
    p('乙方指定账户为', cs(2), '虚构银行示例支行', ce(2), '。'),
    tbl([['项目', '金额'], ['首付款', '十万元']]),
])
A_CM = [
    ('1', '王同事（示例）', 'WT', '2026-11-05T09:00:00Z', '保密条款我们的标准是五年，可以再谈。', '1000A001', None, False),
    ('2', '王同事（示例）', 'WT', '2026-11-05T09:10:00Z', '账户信息待财务确认。', '1000A002', None, False),
]

# ---------- 对方稿（B） ----------
B_BODY = ''.join([
    p('第三条 费用与支付', h=True),
    p('甲方应在收到发票后', cs(10), '十五日内', ce(10), '支付服务费，逾期每日按未付金额的万分之五支付违约金。'),
    p('第五条 违约责任', h=True),
    p('任何一方违约的，', cs(13), '违约金上限', ce(13), '为合同总额的百分之二十。'),
    p('第七条 保密', h=True),
    p('双方对本合同内容负有', cs(15), '保密义务', ce(15), '，期限为三年。'),
    p('第九条 合同解除', h=True),
    p('经双方协商一致可以解除本合同。', cs(16), dl('乙方可单方解除合同。'), ce(16)),
    p('第十条 付款账户', h=True),
    p('乙方指定账户为', cs(18), '虚构银行示例分行', ce(18), '。'),
    tbl([['项目', '金额'], ['首付款', p(cs(19), '十二万元', ce(19))]]),
    p('第十二条 其他', h=True),
    p(cs(20), '本合同一式两份。'),
    p('双方各执一份。', ce(20)),
])
B_CM = [
    ('10', '李律师（示例）', 'LL', D, '付款周期能否改为收到发票后十五日内？我方财务流程需要。', '2000B010', None, False),
    ('11', '赵经理（示例）', 'ZJ', '2026-11-09T10:00:00Z', '内部先确认一下，原则上可以接受。', '2000B011', '2000B010', False),
    ('13', '李律师（示例）', 'LL', D, '违约金上限是否按合同总额计算？', '2000B013', None, True),
    ('14', '测试审阅人', 'CS', '2026-11-09T11:00:00Z', '按总额，我们坚持。', '2000B014', '2000B013', False),
    ('15', '李律师（示例）', 'LL', D, '保密期限三年是否从合同终止起算？', '2000B015', None, False),
    ('16', '李律师（示例）', 'LL', D, '这一句我方删掉了，请确认。', '2000B016', None, False),
    ('18', '王同事（示例）', 'WT', '2026-11-07T08:00:00Z', '这里先别松口，等财务确认后再回。\n内部意见，勿外发。', '2000B018', None, False),
    ('19', '李律师（示例）', 'LL', D, '首付款调整为十二万元。', '2000B019', None, False),
    ('20', '李律师（示例）', 'LL', D, '份数按惯例。', '2000B020', None, False),
]
# 第十二条在 A 里没有：A 末尾补上同样的文字（批注挂在没有修订的地方）
A_BODY += p('第十二条 其他', h=True) + p('本合同一式两份。') + p('双方各执一份。')

build(os.path.join(OUT, 'cm-A.docx'), A_BODY, A_CM)
build(os.path.join(OUT, 'cm-B.docx'), B_BODY, B_CM)
import re
build(os.path.join(OUT, 'cm-plain-B.docx'), re.sub(r'<w:commentRange(Start|End) w:id="\d+"/>|<w:r><w:commentReference w:id="\d+"/></w:r>', '', B_BODY), [])
print('ok', OUT)
