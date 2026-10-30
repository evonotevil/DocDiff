# 随机生成审阅稿写回的压力样本（全部虚构）：随机样式的 run、超链接、表格、列表、制表符和换行，
# 再随机改词、增删段落、改单元格、增删表格行、挪段落。
# 用法：python3 scripts/make-review-fuzz.py <份数> [输出目录，默认 work/review-fuzz] [种子]
import sys, os, random, importlib.util
spec = importlib.util.spec_from_file_location('fx', os.path.join(os.path.dirname(__file__), 'make-review-fixtures.py'))
N = int(sys.argv[1]) if len(sys.argv) > 1 else 50
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'work', 'review-fuzz')
SEED = int(sys.argv[3]) if len(sys.argv) > 3 else 1
sys.argv = [sys.argv[0], OUT]  # 让夹具脚本把它自己的样本也写到这里之外的目录不受影响
os.makedirs(OUT, exist_ok=True)
src = open(spec.origin, encoding='utf-8').read().split('# ---------- 1.')[0]
fx = {}
exec(compile(src, spec.origin, 'exec'), fx)
r, p, tbl, make = fx['r'], fx['p'], fx['tbl'], fx['make']
W = '甲方 乙方 本合同 服务 费用 期限 保密 违约金 通知 争议 仲裁 法院 附件 数据 交付 验收 发票 税费 许可 责任 赔偿 终止 续约 Party Service Fee Term data'.split()
rnd = random.Random(SEED)
def words(k): return ''.join(rnd.choice(W) + rnd.choice(['', '，', ' ', '、', '']) for _ in range(k))
def runs_of(text):
    out, i = [], 0
    while i < len(text):
        j = min(len(text), i + rnd.randint(1, 8))
        seg = text[i:j]
        kind = rnd.random()
        if kind < 0.08: out.append(f'<w:hyperlink w:anchor="a{rnd.randint(1,9)}">{r(seg)}</w:hyperlink>')
        elif kind < 0.12: out.append(f'<w:r><w:t xml:space="preserve">{fx["esc"](seg)}</w:t><w:tab/></w:r>'); text = text[:j] + '\t' + text[j:]; j += 1
        else: out.append(r(seg, b=rnd.random() < 0.15, i=rnd.random() < 0.1))
        i = j
    return out
def para(text, style=None): return p(*runs_of(text), style=style)
def mutate(t):
    k = rnd.random()
    if not t or k < 0.25: return t
    a = rnd.randint(0, len(t)); b = min(len(t), a + rnd.randint(0, 6))
    if k < 0.5: return t[:a] + words(rnd.randint(1, 2)) + t[b:]
    if k < 0.7: return t[:a] + t[b:]
    if k < 0.85: return t[:a] + words(1) + t[a:]
    return words(rnd.randint(3, 8))
for n in range(N):
    items = []
    for i in range(rnd.randint(5, 30)):
        x = rnd.random()
        if x < 0.1: items.append(('h', words(2)))
        elif x < 0.18: items.append(('t', [[words(1) for _ in range(3)] for _ in range(rnd.randint(2, 5))]))
        elif x < 0.28: items.append(('li', words(rnd.randint(2, 6))))
        else: items.append(('p', words(rnd.randint(3, 15))))
    def render(its):
        out = []
        for k, v in its:
            if k == 'h': out.append(para(v, 'Heading1'))
            elif k == 'li': out.append(para(v, 'ListNumber'))
            elif k == 't': out.append(tbl(v))
            else: out.append(para(v))
        return ''.join(out)
    B = []
    for k, v in items:
        z = rnd.random()
        if z < 0.08: continue
        if k == 't':
            rows = [[mutate(c) for c in row] for row in v if rnd.random() > 0.15]
            if rnd.random() < 0.3: rows.append([words(1) for _ in range(3)])
            B.append((k, rows or v))
        else: B.append((k, mutate(v)))
        if z > 0.93: B.append(('p', words(rnd.randint(3, 10))))
    if len(B) > 3 and rnd.random() < 0.3:
        x = B.pop(rnd.randrange(len(B))); B.insert(rnd.randrange(len(B)), x)
    # 同一份随机样式只生成一次：A 和 B 各自重新抽样式，模拟两边格式也不完全一样
    make(f'f{n:03d}', 'A', render(items)); make(f'f{n:03d}', 'B', render(B))
print('ok', N, OUT)
