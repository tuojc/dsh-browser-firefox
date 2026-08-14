#!/bin/bash
# dsh-browser 一键安装：构建并链接插件 → 构建扩展 → 复制到稳定位置 → 打开 chrome://extensions。
# dsh-browser one-command install: build and link the plugin → build the extension → copy it to a stable location → open chrome://extensions.
# 之后无需任何配置：扩展自动探测本机 dsh 并连接（回环免 token）。
# No further configuration is required: the extension discovers local dsh automatically and loopback connections require no token.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXT="$ROOT/extensions/dsh-browser"
PLUGIN="$ROOT/packages/browser/bridge-browser"

print_step() {
  printf '\n[%s/4] %s\n' "$1" "$2"
  printf '      %s\n' "$3"
}

print_pair() {
  printf '%s\n' "$1"
  printf '   %s\n' "$2"
}

print_step 1 "构建浏览器桥" "Build the browser bridge"
(cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter @deepseek-ai/dsh-bridge-browser run build >/dev/null 2>&1)

print_step 2 "注册到本机 web profile" "Register with the local web profile"
(cd "$ROOT" && pnpm exec dsh plugin --profile web add "@deepseek-ai/dsh-bridge-browser@link:$PLUGIN" >/dev/null)

print_step 3 "构建 Chrome 扩展" "Build the Chrome extension"
(cd "$ROOT" && pnpm --filter dsh-browser-extension run build >/dev/null 2>&1)

print_step 4 "准备扩展并打开 Chrome" "Prepare the extension and open Chrome"
DIST_DIR="$HOME/.dsh/browser-extension"
if [ -f "$DIST_DIR/manifest.json" ]; then
  IS_UPDATE=1
else
  IS_UPDATE=0
fi
mkdir -p "$DIST_DIR"
rsync -a --delete-after "$EXT/dist/" "$DIST_DIR/"
echo -n "$DIST_DIR" | pbcopy

open -a "Google Chrome" "chrome://extensions" 2>/dev/null || open -b com.google.Chrome "chrome://extensions"
printf '\n'
if [ "$IS_UPDATE" -eq 1 ]; then
  print_pair "检测到已有扩展，文件已安全更新。" "Existing extension detected; its files were updated safely."
  print_pair "请在 Chrome 扩展管理页找到“dsh 浏览器助手”，点击“重新加载”。" "Find “dsh Browser Assistant” in Chrome Extensions and click “Reload”."
else
  print_pair "Chrome 扩展管理页已打开，请完成以下操作：" "Chrome Extensions is open. Complete these steps:"
  printf '\n'
  print_pair "1. 开启右上角的“开发者模式”" "Enable “Developer mode” in the upper-right corner"
  print_pair "2. 点击“加载已解压的扩展程序”" "Click “Load unpacked”"
  print_pair "3. 按 Cmd+Shift+G，粘贴以下路径（已复制到剪贴板）：" "Press Cmd+Shift+G and paste this path (already copied):"
  printf '   %s\n' "$DIST_DIR"
fi

printf '\n'
print_pair "加载完成后：" "After loading the extension:"
print_pair "• 点击工具栏中的 DeepSeek 鲸鱼图标，打开侧边栏" "Click the DeepSeek whale icon in the toolbar to open the side panel"
print_pair "• 扩展会自动发现本机 dsh，无需填写地址或 token" "The extension discovers local dsh automatically; no address or token is required"
print_pair "• 启动固定版本：cd $ROOT && pnpm start" "Start the pinned version: cd $ROOT && pnpm start"
print_pair "• 或启动 npm 最新版本：npx @deepseek-ai/dsh web" "Or start the latest npm version: npx @deepseek-ai/dsh web"
