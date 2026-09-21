# DocDiff 落地页（方案 A · 野生绿）

`docs/` 是 DocDiff 的产品落地页目录，通过 GitHub Actions 发布到 GitHub Pages。本文件是项目维护说明，不参与网站部署。

- 入口文件：`docs/index.html`（Design Component 导出，由 `support.js` + `vendor/react*.js` 渲染）
- 旧地址：`docs/Main.dc.html` 仅保留跳转，兼容已有链接
- `docs/assets/`：页面引用的界面截图和图标；商店宣传图放在仓库根的 `screenshots/`
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

- 下载按钮链接在 `docs/index.html` 的脚本区（`this.dlUrls`）和 Hero 区两个硬编码按钮，发新版本时同步修改版本号（共 6 处）。
- 页面根据浏览器宽度排版；修改布局时检查桌面、平板和手机宽度，并确认页脚下载区域可以直接滚动到达。
