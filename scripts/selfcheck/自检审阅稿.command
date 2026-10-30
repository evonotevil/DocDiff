#!/bin/bash
# DocDiff 审阅稿 · 本机自检（macOS）。用已安装的 DocDiff 自带的运行环境，不需要另装任何东西，不联网。
cd "$(dirname "$0")"
APP=""
for a in "/Applications/DocDiff.app" "$HOME/Applications/DocDiff.app"; do [ -x "$a/Contents/MacOS/DocDiff" ] && { APP="$a/Contents/MacOS/DocDiff"; break; }; done
[ -n "$APP" ] || { echo "没找到 DocDiff.app，请先安装 DocDiff 1.8 测试版。"; read -n1 -r -p "按任意键关闭"; exit 1; }
DIR="$1"
if [ -z "$DIR" ]; then
  echo "把放合同的总文件夹拖进这个窗口，然后按回车："
  echo "（总文件夹里每个子文件夹放一组：原稿和对方改稿两份 .docx）"
  read -r DIR
  DIR="${DIR%\"}"; DIR="${DIR#\"}"; DIR="$(echo "$DIR" | sed -e 's/\\ / /g' -e 's/[[:space:]]*$//')"
fi
ELECTRON_RUN_AS_NODE=1 "$APP" "$(pwd)/review-selfcheck.cjs" "$DIR"
echo; read -n1 -r -p "按任意键关闭"
