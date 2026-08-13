#!/bin/bash
# dsh-browser 一键安装：构建并链接插件 → 构建扩展 → 复制到稳定位置 → 打开 chrome://extensions。
# 之后无需任何配置：扩展自动探测本机 dsh 并连接（回环免 token）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extensions/dsh-browser"
PLUGIN="$ROOT/packages/browser/bridge-browser"

echo "== 1/4 构建桥插件 =="
(cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter @deepseek-ai/dsh-bridge-browser run build >/dev/null 2>&1)

echo "== 2/4 链接桥插件到本机 web profile =="
(cd "$ROOT" && pnpm exec dsh plugin --profile web add "@deepseek-ai/dsh-bridge-browser@link:$PLUGIN" >/dev/null)

echo "== 3/4 构建 Chrome 扩展 =="
(cd "$ROOT" && pnpm --filter dsh-browser-extension run build >/dev/null 2>&1)

echo "== 4/4 复制到稳定位置并打开 chrome://extensions =="
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
echo "  · 先启动 dsh：cd $ROOT && pnpm start"
