# 2000 段、40 处零散改动（含 3 处移动、2 处整段删除/新增、长短段落混合），用来检查差异地图在“正文按需挂载”下的位置精度
import docx, random
random.seed(7)
def para(i):
    n = 1 + (i * 37) % 9
    return f"第{i+1}条 " + "本条款约定双方在合作期间的权利义务与履约方式，" * n
A = [para(i) for i in range(2000)]
B = list(A)
for k in range(35):
    i = 30 + k * 55
    B[i] = B[i].replace("权利义务", "责任与义务", 1).replace("履约方式", "付款期限为15日", 1)
del B[1500]; B.insert(400, "新增条款：乙方应每季度提交一次服务报告。")
mv = B.pop(1800); B.insert(200, mv)
for name, ps in (("sparse-2000-A.docx", A), ("sparse-2000-B.docx", B)):
    d = docx.Document()
    for p in ps: d.add_paragraph(p)
    d.save(name)
