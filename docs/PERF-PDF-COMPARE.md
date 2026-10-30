# 两份十几页 PDF 比较时界面卡死：根因与修复

- 分支：`perf/pdf-compare-wip`。基于 1.7.4（`ff49598`），改动集中在 8 个渲染进程文件，不涉及比较算法。
- 测试只用合成夹具：`scripts/make-slow-pdf-fixtures.py` 在 `work/fixtures/` 生成 `slow-A.pdf`、`slow-B.pdf`，内容全是虚构占位文字。
  - Document A 有 196 段，Document B 有 532 段，都是 14 页；B 插入了 336 段新内容，另有 5 段小修改。
  - DocDiff 在富文本里报 968 处差异，纯文本 652 处。
- 过程中没有读取任何真实文件、下载目录或最近比较记录，日志里只出现 Document A / B。
- 测试环境：云端 Linux，2 vCPU（Xeon），Electron 37.10.3，窗口 1440×900，全新配置。

## 1. 根因

1.7.4 的富文本已经有分块挂载和 `content-visibility`，但对这类文档不起作用，原因有两个：

1. **是否分块按“段数”判断。** 这份文档只有约 260 行，低于 360 行的门槛，于是整篇挂载。
2. **中文按字切分。** 同一处新增里的每个字都单独是一个 `<span data-mi>`。修改行里成段新增的文字，几百个字就是几百个 span。

两者叠加，富文本里有 **53,257 个 span、约 5.6 万个 DOM 节点**。在此基础上，还有几件事放大了卡顿：比较本身在主线程同步算；差异地图在动画帧里读版面尺寸，强制整篇同步重排；图像模式的逐像素比较也在主线程。

### 根因表（修复前，`work/prof/before-trace` 的 performance trace + CPU profile）

按渲染主线程上超过 50 ms 的任务归类，共约 20.7 秒：

| 阶段 | 修复前耗时 | 占长任务时间 | 是否阻塞主线程 | 代码位置 | 证据 |
|---|---|---|---|---|---|
| 1. PDF 读取、PDF.js 解析 | 没有超过 200 ms 的任务 | — | 否（PDF.js 在 Worker 里） | `lib/pdf.ts` `parsePdf` | 没有长任务的 CPU 采样落在 `parsePdf` |
| 2. 文字提取后的比较（diff） | 打开时 907 ms 一整块；切到纯文本再 720 ms | 8% | **是**，同步、不可取消 | `lib/useDiff.ts`：阈值 1500 段 / 15 万字，这份文档低于阈值，走同步路径 | 任务内 89–91% 的采样在 `diffDocs` / `tokDiff` |
| 3. 首次 React 渲染 | 975 ms | 计在“其他”里 | **是** | `components/DocBlock.tsx` 的 `coalesce` 只合并没有差异的字；`views/RichView.tsx` | 5.3 万个 `TokSpan` |
| 4. 双栏块和占位的样式、排版、绘制 | 打开时 2,203 ms（UpdateLayoutTree 950 + Layout 871）；之后每次切换和滚动都有 | **46%** | **是** | 同上：`RichView` 的 `ALL_BELOW = 360` 按段数判断，没有分块 | Layout 事件 totalObjects 约 5.6 万 |
| 5. 差异地图扫描和测量 | 打开时 637 ms；切回富文本 **2,268 ms**，其中 `sig()` 读 `scrollHeight` 强制同步重排约 1.9 秒 | 1%（另一部分算在第 4 项） | **是** | `components/ChangeMap.tsx`：在 rAF 里同步测量 | 73% 的采样在 `measure → sig` |
| 6. 右侧差异列表和筛选 | 每次筛选 200–300 ms | 少 | **是** | `components/ChangeList.tsx`：一次替换 400 行，不分批、不做 memo | 筛选时 React 提交 + DOM 增删 |
| 7. 页面图片的像素读取和逐像素比较 | 每页 170–412 ms，共 14 次；ImageData 引发的整堆 GC 每次最多约 209 ms | 16% | **是** | `lib/pages.ts` `diffPage`：pixelmatch 在主线程，在 PDF.js 渲染完成的回调里执行 | 92–98% 的采样在 `pixelmatch` / `antialiased` |
| 8. WebP 编码、页面缓存、模式切换 | `toBlob` 本身是异步的；从图像模式切回富文本 2.8 秒，是第 3–5 项的重复 | — | 切回时是 | `RichView` 整篇重建 | — |
| 其他（React 调度、GC） | 包含第 3 项 | 28% | 是 | — | — |
| 修订审阅视图 | 切过去 1.8 秒，整篇连续重渲染 3–4 次 | — | 是 | `views/RedlineView.tsx`：每次选中、每次读入结论都重渲染整篇 | 每次约 150 ms 的 `RedlineView` |

## 2. 改动（只做性能，不改比较算法和结果）

| 文件 | 改了什么 | 为什么 |
|---|---|---|
| `components/DocBlock.tsx` | `coalesce` 把同一处差异里连续、类别 / 编号 / 提示文字都相同的字合成一个 span，用 `data-mi` / `data-mj` 记首尾序号 | 5.3 万个 span → 245 个。显示、`data-cid`、选中高亮都不变 |
| `views/RichView.tsx` | 点词对齐按 `data-mi..data-mj` 区间查找另一侧；分块同时限制“行数”和“排版行数”（`CH_UNITS = 80`，约两屏）；是否分块改看总排版行数（超过 600 就分块）；首屏只挂第一块；按结果缓存每行的排版成本；`RichView` 用 `React.memo` | 长段落的 PDF 也能分块，首屏只排一屏左右；筛选、悬停时正文不再重渲染 |
| `components/ChangeMap.tsx` | 改到“这一帧画完之后”（rAF + 0 ms 定时器）再测量 | 测量时版面已经算好，读尺寸不再强制同步重排 |
| `lib/useDiff.ts` | 进 Worker 的阈值降到 400 段 / 2 万字 | 中等文档也在后台比较，期间显示“正在比较…”，可以取消。小文档仍然同步算 |
| `lib/pagediff.worker.ts`（新增）、`lib/pages.ts` | pixelmatch、差异区域分组、差异图 PNG 编码移进 Worker（像素用 transferable 传过去）；两页截图的编码和像素比较同时进行；Worker 不可用时退回主线程，算法代码完全相同 | 主线程每页只剩取像素约 10–20 ms |
| `views/RedlineView.tsx` | 每段修订用 `React.memo`，只在这一段的结论或选中状态变化时重渲染；分批挂载，每帧 60 段 | 切到修订审阅不再整篇重复渲染 |
| `components/ChangeList.tsx` | 每一行用 `React.memo`；换筛选时先画 60 条，之后每帧补 60 条，直到 400 条；“再显示 n 处”的行为不变 | 点筛选在一帧内就有反馈 |

已经评估过、这次没有做的：
- 页面图片先出低分辨率版：渲染本身不在主线程，没有必要。
- 用 `startTransition` 掩盖阻塞：没用。
- 降低比较精度、合并差异、修改 diff 语义：都没碰。

## 3. 前后数据

同一台机器，修复前（1.7.4）和修复后交替各跑 3 轮。原始数据在 `work/prof/final2-before-*/`、`work/prof/final2-after-*/`，每轮有 `summary.json`、`events.json`、`cpu.cpuprofile`。表中为中位数，括号里是范围：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 打开 → 结果出现 | 5,311 (4,784–5,334) ms | 3,561 (3,186–3,582) ms |
| 打开期间主线程 >1 秒无响应 | 1 次 | 0 次（探测最大延迟 177 ms） |
| 超过 200 ms 的长任务 | 14 个 | **0 个** |
| 最长任务 | 1,357 ms | **99 ms** |
| 长任务合计 | 11,151 ms | 617 ms |
| 富文本 DOM 节点 | 56,561 | 2,433 |
| 滚动（每帧 +60 px） | 23.7 FPS，P95 帧间隔 67 ms | 41 FPS，P95 50 ms |
| J / K（输入 → 两帧之后） | 88 / 101 ms | 67 / 51 ms |
| 筛选“新增” / “全部” | 159 / 189 ms | 127 / 98 ms |
| 切到纯文本 / 修订审阅 / 回到富文本 | 883 / 1,228 / 1,864 ms | 82 / 242 / 96 ms |
| 从图像模式切回富文本 | 1,562 ms | 109 ms |
| 图像模式比完 14 页 | 8,696 ms | 5,775 ms |
| 图像期间主线程探测最大延迟 | 172 ms | 28 ms |
| 图像完成时渲染进程内存 | 871 MB | 422 MB |
| 结束时 GC 后 JS 堆 | 46 MB | 25 MB |

**验收测试**（`scripts/e2e-pdf-perf.cjs`，按键在页面内计时）：

| 项目 | 修复前 | 修复后 |
|---|---|---|
| 点“开始比较”后可见反馈 | 2,295 ms 才出现结果，中间没有进度界面，也没法取消 | 179 ms 出现带“取消比较”的进度界面，992 ms 出结果 |
| J / K 中位 | 36 / 47 ms | 28 / 30 ms |
| 筛选中位 | 113 ms | 74 ms |
| 滚动（每帧 +40 px） | 31.7 FPS | 57.7 FPS |
| 最长任务 | 1,079 ms | 123 ms |
| 取消比较 → 重新比较 | 不支持（没有取消入口） | 正常 |

修复后 9 项全部通过，修复前 4 项失败。

**连续操作内存**（`scripts/soak-pdf-compare.cjs`，两边都做 24 轮相同的操作：J/K、滚动、筛选、切换四种视图，其中 8 次进入图像模式；`work/prof/soak24-*.json`）：

| | 修复前 | 修复后 |
|---|---|---|
| 渲染进程峰值 | 1,083 MB | **675 MB** |
| 全部进程峰值 | 1,475 MB | 1,055 MB |
| 结束后空闲 20 秒 + GC | 441 MB，JS 堆 48 MB | 388 MB，JS 堆 25 MB |
| 切换视图（中位 / P95） | 908 / 1,639 ms | 178 / 265 ms |
| J（中位 / P95） | 87 / 207 ms | 51 / 97 ms |
| 筛选（中位 / P95） | 131 / 177 ms | 65 / 120 ms |
| 滚动一屏（中位 / P95） | 69 / 92 ms | 36 / 47 ms |

修复后内存从 675 MB 回落到 388 MB。

## 4. 结果没有变

`scripts/result-fingerprint.cjs` 记录了以下内容，修复前后逐项比较：富文本、纯文本、修订审阅的差异数；每处差异（编号 + 类别 + 文字哈希）；比较范围；图像模式每页的差异比例和区域数。

| 夹具 | 结果 |
|---|---|
| slow（合成 PDF） | 完全一致 |
| vector-pdf-30（中文矢量 PDF） | 完全一致 |
| cn-mix | 完全一致 |
| word-1250 | 文字结果完全一致。图像模式有 32 页的区域数不同，但 1.7.4 自己跑两次也有同样多的页不同：Word 排版成 PDF 每次略有不同，不是这次改动造成的 |

## 5. 测试命令

```bash
python3 scripts/make-slow-pdf-fixtures.py work/fixtures          # 生成合成夹具
npx vite build
xvfb-run -a node scripts/e2e-pdf-perf.cjs work/fixtures/slow-A.pdf work/fixtures/slow-B.pdf work/reg/pdfperf   # 验收（9 项）
xvfb-run -a node scripts/profile-pdf-compare.cjs work/fixtures/slow-A.pdf work/fixtures/slow-B.pdf work/prof/x [--trace]   # 计时 + CPU profile（+ trace）
python3 scripts/analyze-trace.py work/prof/x 200                  # 长任务逐个归因到函数
python3 scripts/summarize-profiles.py work/prof/final2-before- work/prof/final2-after-
SOAK_ROUNDS=24 xvfb-run -a node scripts/soak-pdf-compare.cjs work/fixtures/slow-A.pdf work/fixtures/slow-B.pdf work/prof/soak.json
APP=<另一版本目录> xvfb-run -a node scripts/result-fingerprint.cjs <A> <B> <out.json>   # 两个版本分别跑，再比较 JSON
```

回归测试全部通过：

| 测试 | 结果 |
|---|---|
| `npm test` | 41 / 41 |
| `e2e-174-cjk` | 21 项全部通过 |
| `e2e-174-view`（3000 段 Word：分块、跳转、地图、选字、全选、对齐、只看变化） | 17 项全部通过 |
| `e2e-174-progress` | 16 项全部通过 |
| `e2e-173` | 全部通过 |
| `e2e-new-compare` | 48 种组合（含合成 PDF）没有白屏 |

**在 Windows 上手动验证：**

1. 用修复版打开两份十几页的 PDF，点“开始比较”。1 秒内应出现“正在比较…”和“取消比较”，窗口不出现“未响应”。
2. 结果出来后，立刻按 J / K、点“新增”“全部”筛选、拖动滚动，应当跟手。
3. 切换纯文本、修订审阅，再回到富文本，各一次，都应在约 0.3 秒内完成。
4. 进入图像模式，比较过程中滚动、切走都应流畅；在任务管理器里看 DocDiff 内存，比较结束后会回落。
5. 再比较一次，在进度界面点“取消比较”，然后点“重新比较”。

## 6. 剩余风险和后续

- **Windows 没有实测。** 云端没有 Windows 环境。上面的修复针对的是平台无关的主线程工作，但仍建议在原来出问题的那台机器上按第 5 节手动验证。
- **“绝大多数差异是新增”可能是对齐问题。** 合成夹具里新增是真的；但在真实文件里，两份 PDF 的字号、行距不同，段落重建可能把段落切得不一样，导致成片地报成“删除 + 新增”或“新增”。按要求，这次只记录、没有改 diff 语义。建议以后单独查 PDF 段落重建的对齐。
- **纯文本视图仍然整篇挂载。** 这份文档没问题，但几千段的 Word 切到纯文本仍要几秒（1.7.4 报告里已经列出）。
- **右侧清单的筛选**在首次点击时约 120 ms，之后在 100 ms 以内；没有长任务。
- **Linux 上的原生内存回落。** 修复后 24 轮操作结束时内存回到 388 MB，比修复前的 441 MB 低。1.7.4 报告里记录的“Linux 上渲染进程内存随图像轮次缓慢增长、Mac 上没有”这一现象，这次没有处理。
- **不需要改产品设计。** 比较时出现的是已有的“正在比较…”界面，现在会更常见：中等大小的文档也会显示一秒左右。
