#!/bin/bash
# 在 Mac 上把发版用的 zip 做成 dmg，并给 App 做本机签名（1.7.3 起的发版流程）
#
# 为什么在 Mac 上做：dmg 里的磁盘格式（HFS+）只有 macOS 自带的 hdiutil 能可靠生成；
# 云端打包机是 Linux，只能出 zip。
#
# 用法：把这个脚本和 DocDiff-<版本>-mac-arm64.zip / DocDiff-<版本>-mac-x64.zip 放在同一个文件夹，
# 在“访达”里双击运行（或在终端执行）。也可以把文件夹路径作为第一个参数传进来。
# 结果：同一文件夹里生成 DocDiff-<版本>-mac-<架构>.dmg，日志写在 make-dmg.log。
# 脚本不会删除任何文件，zip 用完后请自己清理。
set -euo pipefail
DIR="${1:-$(cd "$(dirname "$0")" && pwd)}"
cd "$DIR"
exec > >(tee make-dmg.log) 2>&1
echo "开始 $(date)  目录：$DIR"

shopt -s nullglob
zips=(DocDiff-*-mac-*.zip)
if [ ${#zips[@]} -eq 0 ]; then echo "没有找到 DocDiff-<版本>-mac-<架构>.zip"; exit 1; fi

for zip in "${zips[@]}"; do
  dmg="${zip%.zip}.dmg"
  work="$(mktemp -d /tmp/docdiff-dmg.XXXX)"
  trap 'rm -rf "$work"' EXIT
  mkdir -p "$work/stage"
  echo "== $zip：解压"
  ditto -x -k "$zip" "$work/stage"
  app="$work/stage/DocDiff.app"
  [ -d "$app" ] || { echo "zip 里没有 DocDiff.app"; exit 1; }

  echo "== 本机签名（ad-hoc）"
  xattr -cr "$app"
  codesign --force --deep --sign - "$app"
  codesign --verify --deep --strict "$app"
  echo "签名校验通过"

  ln -s /Applications "$work/stage/Applications"
  echo "== 生成 $dmg"
  rm -f "$dmg"
  hdiutil create -volname "DocDiff" -srcfolder "$work/stage" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$dmg"
  hdiutil verify "$dmg"
  rm -rf "$work"; trap - EXIT
done

echo "== SHA-256"
shasum -a 256 DocDiff-*-mac-*.dmg
echo "完成 $(date)"
