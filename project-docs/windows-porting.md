# Windows 适配清单（已预埋，待启用）

此文档是早期适配计划的历史记录。当前发布状态请以仓库根目录的 [README](../README.md) 为准。

当前只发布 macOS 版本。以下是切换到 Windows 时需要检查或打开的地方。已经预埋好的项目标 ✅，需要在 Windows 实机上验证的标 ⬜。

## 代码中的平台差异（集中位置）

| 位置 | 内容 | 状态 |
|---|---|---|
| `electron/main.cjs` → `PLATFORM.windowChrome` | macOS 用隐藏标题栏 + 红绿灯；Windows 用 `titleBarStyle: 'hidden'` + `titleBarOverlay`（系统最小化/最大化/关闭按钮叠在右上角，随深浅色切换颜色） | ✅ |
| `electron/main.cjs` → `ipcMain.on('theme')` | 切换主题时同步 Windows 标题栏按钮颜色 | ✅ |
| `electron/main.cjs` → 菜单 | macOS 有应用菜单（appMenu）；Windows 的"文件"菜单最后一项是"退出" | ✅ |
| `electron/main.cjs` → `second-instance` | Windows 双击文件时复用已打开的窗口 | ✅ |
| `electron/main.cjs` → `prepareTessCache` | 路径用 `path.sep`，解包目录 `app.asar.unpacked` 在两个平台上一致 | ✅ |
| `renderer/src/lib/platform.ts` | `kbd('mod+O')` 在 mac 显示 ⌘O，在 Windows 显示 Ctrl+O；`modPressed()` 判断 ⌘ / Ctrl | ✅ |
| `renderer/src/styles.css` → `[data-platform='win']` | 右上角给系统按钮留 150px；字体回退到 Microsoft YaHei UI | ✅ |
| 通知、任务栏进度 | `Notification` 和 `setProgressBar` 两个平台都支持；`app.dock.bounce` 只在 mac 上调用 | ✅ |

## 需要在 Windows 实机上验证

- ⬜ 标题栏：系统按钮与右上角的卡片不重叠，深色模式下按钮颜色正确
- ⬜ 高 DPI（125% / 150% 缩放）下字体和图标清晰
- ⬜ 中文字体：界面显示为微软雅黑，文档正文显示为宋体
- ⬜ 从资源管理器拖入文件、同时拖入两个文件
- ⬜ 在 Word 里保存后，"文件已更新"提示能出现（Windows 的 `fs.watch` 行为与 mac 不同）
- ⬜ OCR：首次使用时解压语言包到 `%APPDATA%\DocDiff\tesscache`
- ⬜ 导出 PDF / Word 的保存对话框
- ⬜ 安装包：开始菜单快捷方式、卸载程序

## 打包

```bash
npm run dist:win      # 在 Windows 上执行，生成 NSIS 安装包和免安装 zip
```

在 macOS / Linux 上交叉打包需要安装 Wine（含 32 位），NSIS 卸载程序需要它。

## 发布前建议

- 购买代码签名证书（EV 证书可直接通过 SmartScreen），在 `package.json` 的 `build.win` 中配置
- 考虑加入自动更新（electron-updater），需要一个发布服务器或 GitHub Releases
