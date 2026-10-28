#!/bin/bash
# DocDiff 1.7.4 在 Mac 上的回归 + 性能复测（和云端 Linux 用同一套脚本、同一批夹具）。
# 发版时和 scripts/、test/fixtures/、评测夹具一起放进 DocDiff-<版本>-mac复测/，放在 DocDiff安装包/v<版本>/ 下，先运行同目录上一级的“制作DMG.command”生成 dmg，再双击本脚本。
# 期间会反复弹出 DocDiff 窗口，请不要操作鼠标键盘；全程约 30–40 分钟。不删除任何文件，不改你的 DocDiff 设置。
cd "$(dirname "$0")"
HERE="$(pwd)"
RES="$HERE/结果-mac-$(date +%Y%m%d-%H%M)"
mkdir -p "$RES"
exec > >(tee "$RES/运行日志.txt") 2>&1
caffeinate -dimsu -w $$ &
echo "开始 $(date)"

NODE=""
for n in "$(command -v node)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"; do [ -n "$n" ] && [ -x "$n" ] && { NODE="$n"; break; }; done
export PW="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
export ELECTRON="$HOME/DocDiff/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
echo "node: $NODE ($($NODE -v 2>/dev/null))"; echo "playwright: $PW"; echo "electron: $ELECTRON"
[ -n "$NODE" ] && [ -d "$PW" ] && [ -x "$ELECTRON" ] || { echo "缺少 node / playwright / Electron，停止"; exit 1; }
export ELECTRON_VERSION="$("$NODE" -p "require('$HOME/DocDiff/node_modules/electron/package.json').version")"
echo "Electron 版本 ${ELECTRON_VERSION}；机器：$(sysctl -n machdep.cpu.brand_string)，$(sysctl -n hw.ncpu) 核，$(( $(sysctl -n hw.memsize) / 1073741824 )) GB；macOS $(sw_vers -productVersion)"

ARCH=arm64; [ "$(uname -m)" = "x86_64" ] && ARCH=x64
MNT="$(mktemp -d /tmp/dd-test.XXXX)"
mount_app() { hdiutil attach -nobrowse -readonly -mountpoint "$MNT/$1" "$2" >/dev/null && echo "$MNT/$1/DocDiff.app/Contents/Resources/app.asar/electron/main.cjs"; }
M174="$(mount_app 174 "$HERE/../DocDiff-1.7.4-mac-$ARCH.dmg")"
M173="$(mount_app 173 "$HERE/../../v1.7.3/DocDiff-1.7.3-mac-$ARCH.dmg")"
echo "1.7.4: $M174"; echo "1.7.3: $M173"
cleanup() { hdiutil detach "$MNT/174" >/dev/null 2>&1; hdiutil detach "$MNT/173" >/dev/null 2>&1; }
trap cleanup EXIT
[ -d "$MNT/174/DocDiff.app" ] || { echo "没找到 1.7.4 的 dmg，请先运行 制作DMG.command"; exit 1; }

export APP="$HERE/bootstrap.cjs" PERF_FIX="$HERE/fixtures"
FX="$HERE/fixtures"; S="$HERE/test/fixtures/sparse"
v() { export DD_MAIN="$1" APP_VERSION="$2"; }

v "$M174" 1.7.4
echo "== 1. 中文 PDF";        "$NODE" scripts/e2e-174-cjk.cjs "$RES/cjk"
echo "== 2. 地图 / 正文";      "$NODE" scripts/e2e-174-view.cjs "$RES/view"
echo "== 3. 进度文案";         "$NODE" scripts/e2e-174-progress.cjs "$RES/progress"
[ -d "$MNT/173/DocDiff.app" ] && { v "$M173" 1.7.3; echo "== 1.7.3 中文 PDF（对照）"; "$NODE" scripts/e2e-174-cjk.cjs "$RES/cjk-1.7.3"; }

echo "== 4. 性能（各 3 轮 + 1 轮计查询次数）"
for tag in 1.7.3 1.7.4; do
  [ "$tag" = 1.7.3 ] && { [ -d "$MNT/173/DocDiff.app" ] || continue; v "$M173" 1.7.3; } || v "$M174" 1.7.4
  for n in 3000 1250; do
    RUNS=3 "$NODE" scripts/bench-174.cjs "$FX/word-$n-a.docx" "$FX/word-$n-b.docx" "word-$n" "$RES/bench-$tag" | grep -E "^saved|rror"
    RUNS=1 "$NODE" scripts/bench-174.cjs "$FX/word-$n-a.docx" "$FX/word-$n-b.docx" "word-$n" "$RES/bench-$tag" --count-queries | grep -E "^saved|rror"
    RUNS=3 "$NODE" scripts/bench-immediate.cjs "$FX/word-$n-a.docx" "$FX/word-$n-b.docx" "word-$n" "$RES/immediate-$tag" | grep -E "summary|rror"
  done
  RUNS=3 "$NODE" scripts/bench-174.cjs "$S/sparse-2000-A.docx" "$S/sparse-2000-B.docx" sparse-2000 "$RES/bench-$tag" | grep -E "^saved|rror"
  echo "-- 3000 段全文改写（${tag}）"; "$NODE" scripts/probe-rewrite.cjs "$APP" "$FX/3000-rewrite-A.docx" "$FX/3000-rewrite-B.docx" "$RES/rewrite-$tag.json" | tail -4
done
"$NODE" scripts/bench-table.cjs "$RES"/bench-* > "$RES/性能汇总.txt"

v "$M174" 1.7.4
echo "== 5. 内存：8 轮 打开→比较→切换模式→新建比较"
ROUNDS=8 "$NODE" scripts/memory-174.cjs "$RES/memory-1.7.4.json" | grep -E "^\{|saved|rror" | cut -c1-200

echo "完成 $(date)。结果在：$RES"
