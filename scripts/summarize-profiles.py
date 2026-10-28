# 汇总 profile-pdf-compare.cjs 的多轮结果：python3 scripts/summarize-profiles.py <前缀1> <前缀2> ...（例如 work/prof/final2-before-）
import json, sys, glob, statistics as st
for pre in sys.argv[1:]:
    S = [json.load(open(f)) for f in sorted(glob.glob(pre + '*/summary.json'))]
    def m(f):
        v = [f(s) for s in S]
        return f"{st.median(v):g} ({min(v):g}–{max(v):g})"
    print(f"\n## {pre}  runs={len(S)}  version={S[0]['version']}  {S[0]['machine']}")
    rows = [('打开→结果 ms', lambda s: s['openToResultMs']), ('打开期间 >1s 无响应次数', lambda s: s['blockedProbesDuringOpen']), ('打开期间探测最大延迟 ms', lambda s: s['maxProbeLatencyDuringOpen'])]
    rows += [(f'{k} ms', (lambda k: lambda s: s['actions'][k])(k)) for k in ['j1', 'j2', 'k', 'scroll', 'filterIns', 'filterAll', 'tab-plain', 'tab-review', 'tab-rich', 'tab-rich-from-image']]
    rows += [('滚动 FPS', lambda s: s['scroll']['fps']), ('滚动 P95 帧间隔 ms', lambda s: s['scroll']['p95']), ('滚动最大帧间隔 ms', lambda s: s['scroll']['max']),
             ('图像模式完成 ms', lambda s: s['image']['ms']), ('图像期间探测最大延迟 ms', lambda s: s['image']['maxProbeLatency']), ('图像完成时渲染进程 MB', lambda s: s['image']['rendererMB']),
             ('结束时 DOM 节点', lambda s: s['end']['dom']), ('结束时 GC 后 JS 堆 MB', lambda s: s['end']['heapAfterGcMB']), ('结束时渲染进程 MB', lambda s: s['end']['rendererMB']),
             ('长任务数', lambda s: s['longTasks']['count']), ('>200ms 长任务数', lambda s: s['longTasks']['over200']), ('最长任务 ms', lambda s: s['longTasks']['top'][0][1] if s['longTasks']['top'] else 0), ('长任务合计 ms', lambda s: s['longTasks']['totalMs'])]
    for name, f in rows: print(f"| {name} | {m(f)} |")
