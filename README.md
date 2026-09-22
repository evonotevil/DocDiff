# DocDiff

**每一处不同，一眼看清。** DocDiff 可以比较 DOCX、PDF、TXT 文档，格式不同的两份文件也能互比。文档处理在你的电脑上完成，无需上传文件或注册账号。支持中文和 English 界面。

[下载最新版](https://github.com/evonotevil/DocDiff/releases/latest) · [产品主页](https://evonotevil.github.io/DocDiff/) · [更新记录](CHANGELOG.md)

> **首次运行提醒：目前的 macOS 和 Windows 安装包尚未签名。** 请从本仓库的 Releases 下载，并按需核对随版本提供的 `SHA256SUMS.txt`。
>
> - **macOS：** 如果首次打开时提示“无法验证开发者”或“Apple 无法检查 App 是否包含恶意软件”，先尝试打开一次，再到 **系统设置 → 隐私与安全性**，在底部找到 DocDiff，点 **仍要打开**，随后确认 **打开**。[Apple 官方说明](https://support.apple.com/zh-cn/102445)
> - **Windows：** 如果运行安装包时出现“Windows 已保护你的电脑”，确认文件来自上方的 Release 页面后，点 **更多信息 → 仍要运行**。如果没有继续选项，请在 [Issues](https://github.com/evonotevil/DocDiff/issues) 反馈，不必关闭系统的安全保护。

![DocDiff 差异总览界面](docs/assets/hero-overview.jpg)

## 下载与安装

当前版本：**v1.4.3**。支持 macOS 11 及以上、Windows 10 / 11（64 位）。

| 你的电脑 | 下载文件 | 安装方式 |
|---|---|---|
| Mac，Apple 芯片 | [mac-arm64.dmg](https://github.com/evonotevil/DocDiff/releases/download/v1.4.3/DocDiff-1.4.3-mac-arm64.dmg) | 打开镜像，将 DocDiff 拖入“应用程序” |
| Mac，Intel 芯片 | [mac-x64.dmg](https://github.com/evonotevil/DocDiff/releases/download/v1.4.3/DocDiff-1.4.3-mac-x64.dmg) | 同上 |
| Windows 安装版 | [DocDiff-Setup-1.4.3.exe](https://github.com/evonotevil/DocDiff/releases/download/v1.4.3/DocDiff-Setup-1.4.3.exe) | 双击安装，可选择安装位置 |
| Windows 免安装版 | [DocDiff-1.4.3-win-x64.zip](https://github.com/evonotevil/DocDiff/releases/download/v1.4.3/DocDiff-1.4.3-win-x64.zip) | 解压后运行 `DocDiff.exe` |

不确定 Mac 的芯片类型？点屏幕左上角苹果菜单，选择“关于本机”查看。下载文件无法打开或提示损坏时，先从 [Release 页面](https://github.com/evonotevil/DocDiff/releases/tag/v1.4.3)重新下载，并用该版本的 `SHA256SUMS.txt` 核对文件。

## 三步开始比较

1. 将两份文档拖入“原始文档”和“修改后文档”，或点击“选择文件”。
2. 点击 **查找差异**。删除、新增和修改会以不同颜色标出；右侧变更列表和文档边缘的差异地图可以快速跳到对应位置。
3. 按需要切换对比模式。要逐条决定是否保留修改，进入“修订审阅”，完成后导出结果。

## 能比较什么

| 模式 | 适合的场景 |
|---|---|
| 富文本 | 查看合同、报告中的文字和格式变化，保留标题、列表、表格等结构；点击对应行可让两侧对齐。 |
| 纯文本 | 专注逐行文字差异，可切换并排或合并视图，并隐藏未变化内容。 |
| 修订审阅 | 逐条接受、拒绝或撤销修改，导出 PDF、Word 修订稿或最终稿。 |
| 图像 | 按页面查看排版、图片、分页等视觉变化，支持并排、差异、淡化和滑块视图。 |
| OCR 文本 | 先离线识别扫描件或图片型 PDF 中的中文、英文，再比较文字。 |
| 文件详情 | 比较文件大小、时间、SHA-256，以及可读取的文档属性。 |

DOCX、PDF、TXT 可以任意组合。比较时可设置忽略空白、忽略全角与半角标点，并选择按词或按字符高亮。

## 日常使用

- **定位变化：** 点击右侧变更列表或差异地图，跳到对应内容；在富文本里点击一行，还能对齐两侧文档。
- **处理修订：** 按 `A` 接受、`R` 拒绝、`U` 撤销最近一次决定。全部处理后可导出文档。
- **继续工作：** Word 文件修改并保存后，点击应用内的“重新比较”；“最近比较”可重新打开之前的文件组合。
- **分享结果：** 点击“复制摘要”，将变更整理成 Markdown，粘贴到邮件、聊天或文档中。
- **调整界面：** 左右侧边栏可以折叠；在“设置”中切换中文 / English、浅色 / 深色界面，并查看全部快捷键。

## 常见问题

**文件会上传吗？** 不会。文档比对和 OCR 都在本机完成。下载应用和访问 GitHub 页面需要网络，使用已安装的应用比较文档不需要。

**支持旧版 `.doc` 吗？** 暂不支持。请先在 Word 中另存为 `.docx`。

**为什么 PDF 和 Word 的段落或分页有时对不上？** PDF 不包含可靠的段落结构，DocDiff 会根据版面推断；复杂多栏文档可能不够准确。DOCX 的图像模式由本机排版，分页也可能与 Word 略有不同。

**哪些内容暂不参与比较？** 页眉、页脚和批注暂不参与；导出的 Word 文件会以 `[图片]` 占位表示图片。

遇到其他问题，请到 [Issues](https://github.com/evonotevil/DocDiff/issues) 反馈。项目采用 [MIT License](LICENSE)。
