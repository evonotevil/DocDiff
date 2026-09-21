# DocDiff 落地页（方案 A · 野生绿）

本目录是 DocDiff 的产品落地页，通过 GitHub Pages 发布。

- 入口文件：`Main.dc.html`（Design Component 导出，由 `support.js` + `vendor/react*.js` 渲染）
- `assets/`：页面引用的图片素材
- `README.reference.md`：原设计工具导出的说明（该文件定位为**设计参考稿**，实现时应复刻其数值而非照搬代码）

## 本地预览

```bash
cd docs && python3 -m http.server 8000
# 打开 http://localhost:8000/Main.dc.html
```

## 发布

推送到 main 分支后由 GitHub Actions（`.github/workflows/pages.yml`）自动部署本目录，线上地址：

- https://evonotevil.github.io/DocDiff/Main.dc.html

Pages 设置：Source = main 分支 `/docs`，Build type = GitHub Actions。仓库根的 `.nojekyll` 保留。

## 维护注意

- 下载按钮链接在 `Main.dc.html` 的脚本区（`this.dlUrls`）和 Hero 区两个硬编码按钮，发新版本时同步修改版本号（共 6 处）。
- 页面为固定 1440px 宽设计稿，`<meta name="viewport" content="width=1440">` 让窄屏设备整体缩放显示。
