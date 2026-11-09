# Windows 上图像比较的内存：测试说明（给评测 agent，1.9.3）

**背景：** 1.7.4 时在没有显卡的 Linux（xvfb、软件渲染）上，多轮图像比较后渲染进程的常驻内存会一直涨（16 轮从 457 MB 到 910 MB）；Mac（Apple M2）上同样 8 轮到顶后回落，不涨。JS 堆和图片缓存都不涨，怀疑是原生内存（画布后备内存、解码图片缓存）没还给系统。**Windows 一直没测过。** 这次请在 Windows 上确认。

## 要求

- 只用合成样本，不用任何真实文件；日志里文件一律叫 Document A / Document B。
- 用 1.9.3 的 Windows 安装包，隔离用户配置（`XDG_CONFIG_HOME` 或新建一个 Windows 用户 / 临时 `--user-data-dir`）。
- 记录机器信息：Windows 版本、CPU、内存、显卡（集显 / 独显）、是否远程桌面（远程桌面可能走软件渲染）。

## 样本

在源码目录（`DocDiff-1.9.3-source.zip` 解压后）：

```
python scripts/make-perf-pdf-120.py            # work/perf-pdf120/pdf120-A.pdf、pdf120-B.pdf（各 120 页）
python scripts/make-slow-pdf-fixtures.py work/fixtures   # 14 页、差异很多的一对
```

需要 Python 3 和 `reportlab`（`pip install reportlab`）。中文字体路径在脚本里写的是 Linux 的 `wqy-zenhei.ttc`，Windows 上改成 `C:\Windows\Fonts\msyh.ttc`（微软雅黑）即可。

## 步骤

1. **多轮图像比较（主要）**：`scripts/memory-174.cjs`（1.7.4 起的脚本）在 Windows 上跑 16 轮。

   ```
   set ELECTRON=C:\Users\<你>\AppData\Local\Programs\DocDiff\DocDiff.exe
   set PACKAGED=1
   set PW=<本机 playwright 的路径，如 C:\tools\node_modules\playwright>
   set PDF_A=%CD%\work\perf-pdf120\pdf120-A.pdf
   set PDF_B=%CD%\work\perf-pdf120\pdf120-B.pdf
   set ROUNDS=16
   node scripts/memory-174.cjs memory-win.json
   ```

   如果脚本里有只适用 Linux 的写法（如 `xvfb`、路径分隔符），按 Windows 改，改动写进报告。每轮：进入图像模式 → 等全部页比较完 → 回到富文本 → 强制 GC → 记录。
2. **停止 / 继续**：`scripts/perf-baseline-191.cjs pdf`（1.9.2 起的回归），同时报告停止反馈、停止后页数是否还在涨、继续后是否 120 页无漏无重。
3. **空闲回落**：16 轮结束后空闲 60 秒，再记一次。

## 每轮记录（200 ms 采样取峰值，轮末再记一次）

| 字段 | 来源 |
| --- | --- |
| 渲染进程工作集（MB） | `app.getAppMetrics()` 里 type 为 Tab / Renderer 的 `memory.workingSetSize` |
| 全部进程工作集合计（MB） | 同上求和（可能重复计入共享页，只作观察） |
| 渲染进程私有内存（MB） | `memory.privateBytes`（Windows 上有） |
| JS 堆（MB，GC 后） | `performance.memory.usedJSHeapSize` |
| GPU 进程工作集（MB） | type 为 GPU 的进程 |

## 判断

- **不涨**：GC 后 JS 堆稳定；渲染进程工作集到顶后回落或在 ±10% 内波动 → 记为“Windows 不复现”，和 Mac 一致。
- **涨**：16 轮里渲染进程工作集或私有内存持续上升（每轮 > 15 MB 且没有回落）→ 请附上每轮的数字、GPU 是否启用（`chrome://gpu` 里 Canvas、Rasterization 的状态，可在应用里按 Ctrl+Shift+I 打开开发者工具后访问），以及是否远程桌面。

## 交付

- `memory-win.json` 和一页结论（不涨 / 涨；涨的话涨在哪个进程、每轮多少）。
- 结论只覆盖测过的这台机器和这两组合成样本，不外推到扫描件或更长时间运行。
