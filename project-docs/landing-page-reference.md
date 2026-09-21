# DocDiff 落地页原始设计参考（历史记录）

以下路径和发布说明保留设计导出时的原貌，当前实现与地址以 [落地页维护说明](landing-page.md) 为准。

本目录是 DocDiff 的产品落地页，通过 GitHub Pages 发布。

- 入口文件：`Main.dc.html`（Design Component 导出，由 `support.js` + `vendor/react*.js` 渲染）
- `assets/`：页面引用的图片素材
- `README.reference.md`：原设计工具导出的说明（该文件定位为**设计参考稿**，实现时应复刻其数值而非照搬代码）

## 本地预览

```bash
cd site && python3 -m http.server 8000
# 打开 http://localhost:8000/Main.dc.html
```

## 发布

本目录内容推送到 main 分支后，GitHub Pages（Source: main /site 目录）自动发布，线上地址：

- https://evonotevil.github.io/DocDiff/Main.dc.html

## 维护注意

- 下载按钮链接在 `Main.dc.html` 的脚本区（`RENDER.downloadUrls`），发新版本时同步修改版本号。
- 页面为固定 1440px 宽设计稿，`<meta name="viewport" content="width=1440">` 让窄屏设备整体缩放显示。
