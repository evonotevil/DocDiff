# DocDiff 落地页（方案 A · 野生绿）

本目录是 DocDiff 的产品落地页，通过 GitHub Pages 发布（Source: main 分支 `/docs` 目录，因此实际路径在 `docs/site/` 下）。

- 入口文件：`Main.dc.html`（Design Component 导出，由 `support.js` + `vendor/react*.js` 渲染）
- `assets/`：页面引用的图片素材
- `README.reference.md`：原设计工具导出的说明（该文件定位为**设计参考稿**，实现时应复刻其数值而非照搬代码）

## 本地预览

```bash
cd docs/site && python3 -m http.server 8000
# 打开 http://localhost:8000/Main.dc.html
```

## 发布

本目录内容推送到 main 分支后，GitHub Pages 自动构建发布，线上地址：

- https://evonotevil.github.io/DocDiff/site/Main.dc.html

## 维护注意

- 下载按钮链接在 `Main.dc.html` 的脚本区（`this.dlUrls`），发新版本时同步修改版本号。
- 页面为固定 1440px 宽设计稿，`<meta name="viewport" content="width=1440">` 让窄屏设备整体缩放显示。
