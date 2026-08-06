#!/bin/bash
# dsh-browser 一键安装：构建插件与扩展 → 复制到稳定位置 → 打开 chrome://extensions。
# 之后无需任何配置：扩展自动探测本机 dsh 并连接（回环免 token）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extensions/dsh-browser"
PLUGIN="$ROOT/packages/browser/bridge-browser"

echo "== 1/3 构建桥插件 =="
(cd "$PLUGIN" && pnpm run build >/dev/null 2>&1)

echo "== 2/3 构建 Chrome 扩展 =="
if [ ! -d "$EXT/node_modules" ]; then
  (cd "$EXT" && pnpm install >/dev/null 2>&1)
fi
(cd "$EXT" && pnpm run build >/dev/null 2>&1)

echo "== 3/3 复制到稳定位置并打开 chrome://extensions =="
DIST_DIR="$HOME/.dsh/browser-extension"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR"
cp -R "$EXT/dist/." "$DIST_DIR/"
echo -n "$DIST_DIR" | pbcopy

open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open -b com.google.Chrome "chrome://extensions"
echo ""
echo "已打开 chrome://extensions，按顺序操作："
echo "  1. 打开右上角【开发者模式】"
echo "  2. 点击【加载已解压的扩展程序】"
echo "  3. 在文件选择框按 Cmd+Shift+G，粘贴（已复制到剪贴板）："
echo "     $DIST_DIR"
echo ""
echo "加载完成后："
echo "  · 工具栏出现 DeepSeek 鲸鱼图标，点击打开侧边栏"
echo "  · 扩展自动探测本机 dsh（无需填写地址/token）"
echo "  · 先启动 dsh：cd <宿主 checkout>/dsh-browser && dsh web --config examples/browser-bridge.cordis.yml"
