# 1.9 方案（已实施，随 1.9.0 发布；规则已写进设计规范 3.2）

两块内容：**对对出来走走**（吉祥物）和**英文本地化**。都还没动代码。

---

## 一、对对出来走走

设计在 Figma「方案 · 1.9 · 对对出来走走（待确认）」（M1–M13）。

### 已对齐的决定

- **首页位置**：从底栏上沿探头。
- **场景**：
  - 拖文件时回应。
  - 审阅过半 / 最后一处。
  - 完成页和无差异加变化。
  - 空闲打盹，点它有彩蛋。
  - 设置（关于页）。
  - 完成一件事的瞬间。
  - 等待时。
  - 关心一下你。
  - 里程碑和彩蛋。
- **规范放宽**：动作扩到 20 个，允许小道具（同一时间最多一件），仍是同一个对对，不改身体和配色。
- **节日**：22 个节日加「我们的纪念日」，对所有人出现。
  - 宗教节日只用中性道具和通用祝福。
  - 日期在本机算；农历和每年日期不固定的节日内置 2026–2036 年的日期表。
- **对对图鉴**：藏在「设置 · 关于与更新」里，共 52 项（动作 20、节日 23、彩蛋 9），记录只存本机。
- **开关**：设置 · 通用里加「让对对出来走走」，默认开；节日装扮和彩蛋跟着它。「减少动态效果」时只显示静态图。

### 实施分两批

1. **第一批**：
   - 动作库。
   - 首页（探头、拖文件、两份到齐、打盹）。
   - 审阅过半 / 最后一处。
   - 完成页和无差异的变化。
   - 完成一件事的瞬间。
   - 等待时、关心一下你。
   - 开关。
   - 先实现 `Mascot` 的 `arms / look / mouth / props / blink` 参数和动画类。
2. **第二批**：节日对对和日期表、里程碑与彩蛋、对对图鉴。

### 已确认的两处（2026-11-03）

- **弹窗里的对对**（2026-11-03 改为全部弹窗都出现，取代「对对不进弹窗」）：
  - 位置：标题左侧，32–40px，静态，不做动画，`aria-hidden`，不进读屏顺序。
  - 表情只用现有 5 种，按弹窗选：
    - 这个 PDF 有密码：思考
    - 粘贴文字 / 用模板比较 / 加入新版本 / 沿用上轮结论 / 导出审阅结果：开心
    - 全部接受 / 全部拒绝 / 清空结论：思考（不欢呼，旁边是不可撤回的批量操作）
    - 生成定稿：没有待议时欢呼，有待议时思考
    - 设置：开心；「关于与更新」这一页保留更丰富的版本（图鉴入口）
  - 弹出菜单（「…」菜单、状态说明等 Popover）不放对对。
- **审阅过半的提示**：两个都保留。对对探头，同时保留「过半了！还剩 {n} 处」文字提示，两者同时出现、只出现一次。

### 规范要同步改

- 品牌页的「吉祥物」一节和规范文档的「对对」一节：
  - 动作表。
  - 道具清单与画法（线宽 2–2.5、描边 #4b4b4b、只用品牌色）。
  - 出场频率上限（非用户触发的出场 30 秒内最多一次；同一种成功提示 30 秒内最多一次）。

---

## 二、英文本地化

### 现状（逐条看过约 980 条英文）

- **同一个概念多种叫法**：review copy / review draft，final copy / final version。
- **照搬中文句式**：长句、分号、先解释再说结论；直译内部技术细节（如 “{n} pairings in a single region”）。
- **用词不是法律圈的说法**：Hold、Theirs、Negotiations 等。
- **语气是中文的**：解释多、安抚多；英文界面要短、主动、第二人称。
- **日期写法是中文的**：`{m}月{d}日` → `{m}/{d}`。默认文件名后缀是「-我方意见」。
- **对方能看到的内容是机翻**：审阅稿里的批注、导出的报告，都没有单独打磨。

### 已对齐的决定

- **美式英语**，界面一律**句首大写**（sentence case），和 Figma、Notion、Linear 一致。
- **术语用律师圈说法**（见下表）。
- **范围是全部**：
  - 界面、菜单栏、弹窗和报错。
  - 审阅稿批注和导出报告（对方看得到）。
  - 英文默认文件名。
  - 日期、数字格式。
  - 对对的台词和节日祝福按英文重新写，不是翻译。
- **不另找母语审校**，由我按风格指南直接定稿，配自动检查和英文界面截图自查。

### 英文风格指南（草案）

1. **短**：按钮 1–3 个词，以动词开头（Create redline、Copy summary）。说明最多一行，多的放进 ⓘ。
2. **你**：对用户用 you。DocDiff 不自称 we；必要时直接说 DocDiff。
3. **主动语态，用缩写**：can’t、won’t、you’re。
4. **报错 = 发生了什么 + 怎么办**：
   - 例：“Couldn’t open this file. It may be password-protected — try opening it in Word first.”
   - 不说 sorry，不说 please，不说 successfully。
5. **少讲原理**：内部机制（对齐算法、区块数、哈希）不出现在界面上；需要时放进 ⓘ。
6. **标点**：
   - 文件名、按钮名用弯引号 “ ”。
   - 破折号 — 少用。
   - 列表不加句号；完整句子加句号。
7. **数字、日期、大小**：
   - 一律用 `Intl` 按系统地区格式化：Oct 26；跨年时 Oct 26, 2025；2 min ago；1.2 MB。
   - 单复数用 `Intl.PluralRules`（1.8.1 已有基础）。
8. **长度**：英文按比中文长 40% 预留。会换行的地方在设计里标明，其余单行省略并带悬停全名。
9. **大写**：分组标题不再用 CSS 全大写（现在英文会变成 COMPARISON MODES），改为句首大写的 13/800 小标题。
10. **对方看得到的文字**（批注、报告）：
    - 中性、专业，不带对对的语气。
    - 不出现 DocDiff 的界面用语。

### 核心术语表（草案，约 40 条）

| 中文 | 英文 | 备注 |
|---|---|---|
| 原始文档 / 修改后文档 | Original / Revised | |
| 对方 / 我方 | Counterparty / You（界面）· our side（文件名、批注） | |
| 比较（动词 / 名词） | Compare / Comparison | |
| 差异、处 | Change(s) | “No changes found”；不再混用 difference |
| 差异地图 | Change map | |
| 修订（Word 里的） | Tracked change | |
| 模式：富文本 / 纯文本 / 修订审阅 / 图像 / OCR 文本 / 文件详情 | Formatted / Plain text / Review / Visual / OCR text / File info | |
| 接受 / 拒绝 | Accept / Reject | |
| 待议（状态 / 按钮 / 计数） | Open / Keep open / {n} open items | 避免和“打开文件”的 Open 混淆：按钮写 Keep open |
| 备注 | Note | |
| 批注（Word） | Comment | |
| 审阅稿 / 生成审阅稿 | Redline / Create redline | |
| 定稿 / 生成定稿 | Clean copy / Create clean copy | |
| 审阅记录存档 | Review record | |
| 比较报告 | Comparison report | |
| 往来稿 / 一轮 / 版本 | Negotiation / Round / Version（V3） | “Save as negotiation”，“V2 → V3” |
| 模板 | Template | |
| 最近比较 | Recent | |
| 需要留意 | Needs attention | |
| 比较范围 | Scope | |
| 审阅人 / 修订作者 | Reviewer / Author of changes | |
| 页眉 / 正文 / 页脚 / 脚注 | Header / Body / Footer / Footnotes | |
| 导出 / 复制摘要 | Export / Copy summary | |
| 撤销 | Undo | |
| 新建比较 / 示例合同 | New comparison / Sample contract | |
| 设置分页 | General · Review · Redline & clean copy · Risk · Shortcuts · Storage · About & updates | |
| 对对（吉祥物） | Diffy | 首页彩蛋改为键入 “diffy” |
| 默认文件名 | `{name} - our comments`（审阅稿）· `{name} - clean`（定稿） | 中文仍是 -我方意见 / -定稿 |

### 改写示例（方向，不是终稿）

| 中文 | 现在 | 改后 |
|---|---|---|
| 生成审阅稿 | Create review copy | Create redline |
| 在 Word 里关掉它，DocDiff 会自动写完 | Close it in Word and DocDiff will finish writing | Close it in Word to finish saving |
| 有 {n} 处没能写进审阅稿 | {n} decisions couldn’t be written to the review copy | {n} changes couldn’t be added to the redline |
| 还有 {n} 处待议，建议和对方谈定后再生成 | {n} items are on hold — best to agree on them first | {n} open items — consider resolving them first |
| 两份文档差异太大（单个区段 {n} 组比较），为了不卡死改用了按位置粗配，段落对应关系可能不准。 | The two documents differ too much ({n} pairings…) | These documents are very different, so some paragraphs may be matched imprecisely. |
| 这份文件和两份往来稿都很像 | (同类长句) | This file matches two negotiations. Which one is it? |
| 已看完 {n} 处修订，{h} 处待议 | All {n} changes reviewed, {h} on hold | Reviewed all {n} changes · {h} open |
| 定稿是双方谈完后的干净版：… | The final version is the clean copy once both sides agree: … | A clean copy has every accepted change applied and every rejected change reverted, with no markup. |
| 刚刚 / {n} 分钟前 | just now / {n} min ago | Just now / 5 min ago（交给 Intl.RelativeTimeFormat） |
| 批注：已拒绝，恢复原文 | (机翻) | Rejected — original wording restored. |

### 工作方式

1. **建清单**：脚本抽出全部 `t('…')`，带出处文件和所在界面，加上菜单栏（`electron/main.cjs` 的 `L()`）和导出 / 审阅稿里写入文档的文字，按界面分组。
2. **按界面重写**：首页 → 比较页 → 修订审阅 → 完成页 → 弹窗 → 设置 → 菜单 → 报错 → 对方看得到的内容 → 对对台词。每组改完截英文界面自查。
3. **代码配合**：
   - 日期、相对时间、文件大小改用 `Intl`。
   - 英文默认文件名后缀。
   - 分组标题去掉 CSS 全大写。
   - 英文界面换行和省略的位置按设计核对。
4. **自动检查**（加进测试）：
   - 漏翻：界面里出现中文。
   - 术语：禁用旧词，如 review copy、final version、Hold、Theirs、Negotiations 当按钮名。
   - 禁用词：please、successfully、sorry。
   - 全角标点。
   - 伪本地化：所有英文加长 40% 后截图，检查截断和溢出。
5. **验收**：
   - 英文界面全量截图（浅色 / 深色，960 / 1440）。
   - 术语表与界面一致。
   - 审阅稿批注、导出报告用英文各生成一份虚构样例，人工通读。

### 本地化相关的已知小问题（顺带修）

- **相对时间缩写**：`{n} h ago` / `{n} d ago` 这类缩写改为 `Intl.RelativeTimeFormat`。
- **英文首页提示**：1.8.1 已允许换行，本地化后再按新文案核对。

---

## 三、1.8.1 QA 评测修复（2026-11-03 核实、已对齐，随 1.9 发布）

8 项都已在代码里核实属实。第 1 项用虚构夹具实测复现：对方修订删除表格行或整个编号列表项后，比较页、审阅稿、定稿都多出空行（`["",""]`）或空列表项。现有回归测试只比文字，所以 14/14 通过、没有发现。

### P1

1. **对方修订删除的表格行 / 段落标记**（`docx.ts` 的 `walk`、`draft/ooxml.ts` 的 `acceptExisting`）
   - 表格行：`trPr/del` 的整行在读取时跳过，在 `acceptExisting` 里整行移除。一张表的行全被删时，连表一起移除，避免产生无效的空表。
   - 段落标记：`pPr/rPr/del` 按 OOXML 把本段并入下一段；本段已经没有保留的内容就整段移除。不跨单元格合并：单元格里最后一段原样保留。
   - `docx.ts` 和 `locate()` 必须保持同一种读法；导出 Word 也走同一份解析，一并验证。
   - 回归测试：`make-review-fixtures.py` 加「对方修订删除表格行」「对方修订删除编号列表项」「段落标记删除但保留文字」三个用例；`test-review-draft.mjs` 加结构断言：不能有空表格行、空编号段落，块数对上。
2. **撤销提示的作用范围**（`App.tsx`）
   - `undoToast` 带作用范围：`home`，或这一对文件的 `pk`。
   - 审阅类：单步决定、写备注、交换左右、切换往来稿版本、换文件、`pk` 变化时立即收起；撤销前核对 `snap.pk === pk`，对不上就不写入。
   - 首页删除的提示：进入比较页后**继续显示，「撤销」按钮仍可点，但 `U` 不触发它**，`U` 留给审阅决定。10 秒后照常收起。

### P2

3. **Popover 跟随滚动**：捕获阶段监听滚动、重新定位；触发按钮滚出可视区就关闭，不让菜单孤零零地飘着。
4. **长名称悬停**：`TemplateRow`、`ThreadRow` 的 `.row-open` 补 `title`。
5. **导出 Word**
   - 被删的多行文字补上换行（`DeletedTextRun` 支持 `break`）。
   - 默认文件名「审阅后定稿」改为「审阅记录存档」；英文按 1.9 术语表改为 “Review record”。

### 微交互

6. **快速连按**：保留 220ms 的跳转停顿。停顿里再按键，先立刻完成跳转，再作用到下一处，不会重复作用在同一处。
7. **Popover 缩放原点**：按 `align`（start / end）和弹出方向（向上 / 向下）设置 `transform-origin`。向上弹出时位移方向也反过来（现在是从上往下滑）。
8. **提示悬停暂停**：鼠标悬停或焦点进入 `.toast` 时暂停倒计时，移出后恢复。撤销删除的提示暂停时，真正清除的计时器也要一起暂停，否则悬停超过 10 秒后会撤销失败。

### 设计

这些修复不涉及新的视觉。实施前只在 Figma「1.9 草案」里补一条 Popover 动效规则（原点、方向、跟随滚动），不另出页面。
