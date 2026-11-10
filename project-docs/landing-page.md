# DocDiff 产品主页

`docs/` 是 DocDiff 的产品落地页目录，通过 GitHub Actions 发布到 GitHub Pages。本文件是项目维护说明，不参与网站部署。

- 入口文件：`docs/index.html`（静态 HTML）
- 页面代码与资源：`docs/landing/`（CSS、原生 JavaScript 和 SVG）
- 版本元数据：`docs/updates/latest.json`
- 旧地址：`docs/Main.dc.html` 仅保留跳转，继续兼容已有链接及 URL hash
- 历史页面资源仍保留在 `docs/assets/`；商店宣传图位于仓库根的 `screenshots/`
- `project-docs/landing-page-reference.md`：原设计工具导出的历史说明

## 本地预览

```bash
cd docs && python3 -m http.server 8000
# 打开 http://localhost:8000/
```

## 发布

推送到 main 分支后由 GitHub Actions（`.github/workflows/pages.yml`）自动部署本目录，线上地址：

- https://evonotevil.github.io/DocDiff/

发布工作流会将 `docs/` 打包为 Pages 内容；`/DocDiff/` 自动读取其中的 `index.html`。

## 维护注意

- 下载区在同源读取 `docs/updates/latest.json` 后，使用其中的 `version` 和 `downloads` 更新三个平台的链接、发布页及 `SHA256SUMS.txt`。发版时只需维护该文件，不要在页面脚本中再次硬编码版本号。
- 页面只接受 `https://github.com/evonotevil/DocDiff/releases/` 下与元数据版本一致的官方链接。元数据不可用、格式不正确或链接校验失败时，下载按钮会退回 `https://github.com/evonotevil/DocDiff/releases/latest`，不会继续显示某个可能过期的直链版本。
- 直接以 `file://` 打开页面时无法可靠读取同源 JSON，因此也使用最新版发布页回退；完整检查请通过本地 HTTP 服务进行。
- 页面根据浏览器宽度排版；修改布局时检查桌面、平板和手机宽度，并确认页脚下载区域可以直接滚动到达。

## 发布前验证

1. 运行本地服务器并打开首页，确认浏览器控制台没有错误。
2. 依次选择 Apple 芯片、Intel 芯片和 Windows，确认按钮显示 `latest.json` 中的版本，并指向对应的官方安装包。
3. 确认发布页和校验值链接分别指向该版本的 Release 页面及 `SHA256SUMS.txt`。
4. 暂时让 `updates/latest.json` 返回失败或非法链接，确认三个平台都回退到最新版发布页，页面不显示旧版本号。
5. 检查桌面和手机宽度、键盘操作、移动导航关闭行为，以及 `Main.dc.html#任意锚点` 到首页的兼容跳转。
