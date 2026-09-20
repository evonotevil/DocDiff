#!/usr/bin/env bash
# 在 Linux 上为已签名的 DocDiff.app 制作 macOS 安装镜像（.dmg）
# 依赖：mkfs.hfsplus（hfsprogs）、libdmg-hfsplus 的 hfsplus / dmg 工具、python ds_store
# 用法：scripts/build-dmg-linux.sh <DocDiff.app 所在目录> <输出 .dmg>
set -euo pipefail
APPDIR="$1"; OUT="$2"
TOOLS="${LIBDMG:-/tmp/claude-0/libdmg/build}"
HFSPLUS="$TOOLS/hfs/hfsplus"; DMG="$TOOLS/dmg/dmg"
WORK="$(mktemp -d)"; STAGE="$WORK/stage"
mkdir -p "$STAGE"
cp -a "$APPDIR/DocDiff.app" "$STAGE/"
ln -s /Applications "$STAGE/Applications"

# Finder 窗口布局：左边 DocDiff，右边“应用程序”，拖过去即可安装
python3 - "$STAGE/.DS_Store" <<'PY'
import sys
from ds_store import DSStore
with DSStore.open(sys.argv[1], 'w+') as d:
    d['.']['bwsp'] = {
        'ShowStatusBar': False, 'ShowToolbar': False, 'ShowPathbar': False, 'ShowSidebar': False,
        'ShowTabView': False, 'ContainerShowSidebar': False, 'WindowBounds': '{{240, 180}, {620, 400}}',
    }
    d['.']['icvp'] = {
        'viewOptionsVersion': 1, 'backgroundType': 1,
        'backgroundColorRed': 1.0, 'backgroundColorGreen': 1.0, 'backgroundColorBlue': 1.0,
        'iconSize': 128.0, 'textSize': 14.0, 'arrangeBy': 'none', 'labelOnBottom': True,
        'showIconPreview': True, 'showItemInfo': False, 'gridSpacing': 100.0, 'gridOffsetX': 0.0, 'gridOffsetY': 0.0,
    }
    d['.']['vSrn'] = ('long', 1)
    d['DocDiff.app']['Iloc'] = (165, 190)
    d['Applications']['Iloc'] = (455, 190)
PY

# 按内容大小建一个 HFS+ 卷，写入文件（保留符号链接与权限），再压缩成 .dmg
SIZE_MB=$(( $(du -sm "$STAGE" | cut -f1) * 12 / 10 + 40 ))
IMG="$WORK/volume.hfs"
dd if=/dev/zero of="$IMG" bs=1M count="$SIZE_MB" status=none
mkfs.hfsplus -v "DocDiff" "$IMG" >/dev/null
"$HFSPLUS" "$IMG" addall "$STAGE" --symlinks clone_link >/dev/null
rm -f "$OUT"
"$DMG" build "$IMG" "$OUT" >/dev/null
rm -rf "$WORK"
echo "DMG: $OUT ($(du -h "$OUT" | cut -f1))"
