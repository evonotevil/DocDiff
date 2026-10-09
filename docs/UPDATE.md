# 更新机制

DocDiff 的更新分两个阶段。1.5.1 实现了阶段 0，阶段 1 的前提是代码签名。

---

## 阶段 0（1.5.1 已实现）：只检查，不安装

应用向一个静态 JSON 发一次普通 GET，比较版本号，发现新版就在设置里显示更新日志，
点「打开下载页」用系统浏览器去下载。**不需要任何证书。**

### 需要你做的两件事

**1. 把 feed 传给应用。** 三种方式，优先级从高到低：

| 方式 | 用途 |
|---|---|
| 环境变量 `DOCDIFF_UPDATE_FEED` | 调试、CI |
| 用户数据目录里的 `update-feed.txt`（单行 URL） | 给个别用户临时改地址 |
| `electron/main.cjs` 里的 `UPDATE_FEED` 默认值 | 正式发布。默认值为 `https://evonotevil.github.io/DocDiff/updates/latest.json`，由本仓库的 GitHub Pages 发布 |

用户数据目录：macOS `~/Library/Application Support/DocDiff/`，Windows `%APPDATA%\DocDiff\`。

**2. 把这个 JSON 写入 `docs/updates/latest.json` 并推送到 `main`**（GitHub Pages 工作流会自动发布）：

```json
{
  "version": "1.5.1",
  "pubDate": "2026-10-09",
  "notes": "· 应用内检查更新（设置 ›「关于与更新」）\n· 纯文本 / OCR 视图首次进入从 34.6 秒降到 1.7 秒\n· 差异地图在纯文本 / 修订审阅模式下恢复显示\n· 大文档比对改为后台进行，可取消\n· 两份文档差异过大时，明确提示段落对齐已简化\n· 一段换一段时左右配对，不再拆成删除 + 新增",
  "downloads": {
    "mac-arm64": "https://github.com/evonotevil/DocDiff/releases/download/v1.5.1/DocDiff-1.5.1-mac-arm64.dmg",
    "mac-x64": "https://github.com/evonotevil/DocDiff/releases/download/v1.5.1/DocDiff-1.5.1-mac-x64.dmg",
    "win-exe": "https://github.com/evonotevil/DocDiff/releases/download/v1.5.1/DocDiff-Setup-1.5.1.exe",
    "page": "https://github.com/evonotevil/DocDiff/releases/tag/v1.5.1"
  }
}
```

- `version` 必填，按点分段比较数字（所以 `1.5.1` > `1.4.10`，不是字符串比较）。
- `notes` 原样显示，支持换行，超过 4000 字会被截断。
- `downloads` 按当前平台取 `mac-arm64` / `mac-x64` / `win-exe`，取不到就退回 `page`。
- 下载链接**必须是 https**：`open-url` 这个 IPC 只放行 https，免得被当成任意协议的跳板。

### 行为约定

- 启动后延迟 8 秒才静默检查一次，不和首屏抢资源。
- 设置里「启动时自动检查更新」关掉之后，应用不再发任何网络请求。
- 检查失败一律静默降级：只在设置面板里写一句人话（"连不上更新服务器"之类），不弹窗、不影响比对。
- 请求里除了标准 UA 不带任何信息，尤其不带文件名、路径、文档内容。
- 「跳过这个版本」记在 `prefs-v2.skipVersion`，只压住这一个版本号，更新的版本照常提醒。

---

## 阶段 1（待签名）：应用内下载并安装

### 硬前提

> electron-builder 官方文档原话：**"macOS application must be signed in order for auto updating to work."**

未签名的 macOS 应用，Squirrel.Mac 会直接失败，这不是配置能绕过去的。Windows 侧未签名技术上能跑，
但未签名 exe 会被企业防火墙和 SmartScreen 拦在下载那一步 —— 我们已经踩过。

证书选择（2026 年的情况）：

| 选项 | 价格 | 备注 |
|---|---|---|
| Apple Developer Program | $99/年 | macOS 必需，另需 notarization |
| Azure Artifact Signing | ~$9.99/月 | **资格限美/加/EU/UK 组织主体**，中国主体不适用 |
| OV 证书 | $150–300/年 | Windows 的现实选择；2023-06 起私钥必须存 HSM 或硬件 token |
| EV 证书 | $400+/年 | **不建议**：2024 年起 EV 的"立刻绕过 SmartScreen"已取消，对 SmartScreen 效果和 OV 等同 |

### 代码改动清单

> 下面这几段的现成模板在 `build/update-stage1.example.json`。**别直接塞进 `package.json` 的 `build` 里当注释**——
> electron-builder 会校验 `build` 的 schema，多余的键会让构建直接失败（这坑我踩过一次）。

1. **mac 必须加 `zip` target**，否则不会生成 `latest-mac.yml`，Squirrel.Mac 无从下手：

   ```json
   "mac": {
     "target": ["dmg", "zip"],
     "identity": "Developer ID Application: <你的名字> (TEAMID)",
     "hardenedRuntime": true,
     "gatekeeperAssess": false,
     "entitlements": "build/entitlements.mac.plist",
     "notarize": { "teamId": "TEAMID" }
   }
   ```

2. **`publish` 从 `null` 改成 generic provider**：

   ```json
   "publish": [{ "provider": "generic", "url": "https://.../updates/${channel}" }]
   ```

   这个目录下需要有 electron-builder 产出的 `latest.yml` / `latest-mac.yml` 和安装包本体。
   不建议用 GitHub Releases：国内网络和企业防火墙都不稳。

3. **装 `electron-updater`**，在主进程里替掉现在的 `check-update`：

   ```js
   const { autoUpdater } = require('electron-updater');
   autoUpdater.autoDownload = false;              // 让用户自己决定什么时候下
   autoUpdater.on('update-available', (i) => send('update-available', i));
   autoUpdater.on('download-progress', (p) => send('update-progress', p));
   autoUpdater.on('update-downloaded', () => send('update-ready'));
   ipcMain.handle('check-update', () => autoUpdater.checkForUpdates());
   ipcMain.handle('download-update', () => autoUpdater.downloadUpdate());
   ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
   ```

4. **界面上把「打开下载页」换成「下载并安装」**，中间加一条下载进度和一个「下载完成后重启安装」。
   `UpdateSection` 已经预留了 `upd-acts` 这一行，加按钮即可，布局不用改。

5. 阶段 0 的 JSON feed 建议保留：它是阶段 1 失败时的兜底（比如某个用户的网络下不了安装包，
   至少还能知道"有新版本"并手动去下）。

### 验收要点

- 签名后先用 `spctl -a -vvv DocDiff.app`（macOS）和 `signtool verify /pa`（Windows）确认签名链。
- 在**干净机器**上装旧版 → 触发更新 → 确认能升级且设置与最近比较记录都保留。
- 断网、半途断网、磁盘满三种情况下都不能让应用起不来。
