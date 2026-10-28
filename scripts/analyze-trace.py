# 把 profile-pdf-compare.cjs 存下的 trace.json + cpu.cpuprofile 合起来：
# 列出渲染主线程上超过阈值的任务，以及每个任务里 CPU 采样的包含时间最多的函数（含代码位置）。
# 用法：python3 scripts/analyze-trace.py <目录> [阈值ms=200] [bundle.js]
import json, sys, collections, re
d = sys.argv[1]
thr = float(sys.argv[2]) if len(sys.argv) > 2 else 200
bundle = sys.argv[3] if len(sys.argv) > 3 else None
ev = json.load(open(f'{d}/trace.json'))['traceEvents']
names = {(e['pid'], e['tid']): e['args']['name'] for e in ev if e.get('ph') == 'M' and e.get('name') == 'thread_name'}
main = {k for k, v in names.items() if v == 'CrRendererMain'}
X = [e for e in ev if e.get('ph') == 'X' and (e['pid'], e['tid']) in main]
t0 = min(e['ts'] for e in X)
tasks = sorted([e for e in X if e['name'] in ('RunTask', 'ThreadControllerImpl::RunTask') and e.get('dur', 0) > thr * 1000], key=lambda e: e['ts'])

p = json.load(open(f'{d}/cpu.cpuprofile'))
nodes = {n['id']: n for n in p['nodes']}
parent = {}
for n in p['nodes']:
    for c in n.get('children', []): parent[c] = n['id']
times, t = [], p['startTime']
for dt in p['timeDeltas']: t += dt; times.append(t)
fnline = {}
if bundle:
    src = open(bundle).read().split('\n')
def label(cf):
    n = cf['functionName'] or '(anon)'
    ln = cf['lineNumber']
    return f"{n}@{ln}" if cf['url'] else n
def stack(nid):
    out = []
    while nid in nodes:
        out.append(label(nodes[nid]['callFrame'])); nid = parent.get(nid)
    return out
GEN = {'(root)', '(program)', '(idle)', '(garbage collector)'}
for tk in tasks:
    s, e = tk['ts'], tk['ts'] + tk['dur']
    kids = collections.Counter()
    for c in X:
        if c is not tk and c['ts'] >= s and c['ts'] + c.get('dur', 0) <= e and c['name'] in ('Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'MajorGC', 'MinorGC', 'FunctionCall', 'FireAnimationFrame', 'TimerFire', 'EventDispatch'):
            kids[c['name']] += c.get('dur', 0)
    inc = collections.Counter(); n = 0
    for sid, ts in zip(p['samples'], times):
        if s <= ts <= e:
            n += 1
            for f in set(stack(sid)):
                if f not in GEN: inc[f] += 1
    print(f"\n== t={(s - t0) / 1000:7.0f}ms  dur={tk['dur'] / 1000:5.0f}ms  " + ' '.join(f"{k}={v // 1000}" for k, v in kids.most_common(6)))
    for f, c in inc.most_common(12):
        print(f"   {100 * c / max(1, n):5.1f}%  {f}")
