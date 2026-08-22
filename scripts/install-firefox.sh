#!/bin/bash
# dsh-browser-firefox 一键安装脚本（跨电脑 / 重新部署用）
# 完成：构建 bridge 插件 → 注册到 dsh web profile → 构建并复制 Firefox 扩展 → 打开 about:debugging
set -euo pipefail

print_step() {
  printf '\n[%s/5] %s\n' "$1" "$2"
  printf '      %s\n' "$3"
}

print_pair() {
  printf '%s\n' "$1"
  printf '   %s\n' "$2"
}

fail_pair() {
  printf '\n错误：%s\n' "$1" >&2
  printf 'Error: %s\n' "$2" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail_pair "$2" "$3"
}

# ---- 定位 workspace 根目录 ----
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-}")/.." && pwd)"
if [ ! -f "$ROOT/package.json" ] || [ ! -f "$ROOT/pnpm-lock.yaml" ] || \
   [ ! -d "$ROOT/plugin" ] || [ ! -d "$ROOT/extension" ]; then
  fail_pair "未找到完整的 dsh-browser-firefox workspace（请先解压源码包）。" \
            "Complete dsh-browser-firefox workspace not found (unpack the source archive first)."
fi

EXT="$ROOT/extension"
PLUGIN="$ROOT/plugin"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
EXT_COPY_DIR="$DSH_HOME_DIR/browser-extension"

# ---- 前置依赖检查 ----
print_step 1 "检查前置依赖" "Check prerequisites"
require_command node "未找到 Node.js；请先安装 Node.js >= 20。" "Node.js >= 20 was not found; install it first."
require_command pnpm "未找到 pnpm；请安装（npm install -g pnpm，项目兼容 11.x）。" "pnpm was not found; install it (npm install -g pnpm; any 11.x works)."
if command -v dsh >/dev/null 2>&1; then
  print_pair "✓ dsh 已安装：$(dsh --version 2>/dev/null || echo '?')" "dsh found."
else
  print_pair "⚠ dsh 未安装，请先执行：npm install -g @deepseek-ai/dsh" "dsh not found; run: npm install -g @deepseek-ai/dsh"
  exit 1
fi

# ---- 安装依赖并构建 ----
print_step 2 "安装 workspace 依赖" "Install workspace dependencies"
(cd "$ROOT" && pnpm install --frozen-lockfile)

print_step 3 "构建 bridge 插件与 Firefox 扩展" "Build bridge plugin and extension"
(cd "$ROOT" && pnpm --filter @deepseek-ai/dsh-bridge-browser run build)
(cd "$ROOT" && pnpm --filter dsh-browser-extension run build)

# ---- 注册 bridge 到 web profile ----
print_step 4 "注册 bridge 插件到 dsh web profile" "Register bridge plugin with the web profile"
(cd "$ROOT" && dsh plugin --profile web add "@deepseek-ai/dsh-bridge-browser@link:$PLUGIN" >/dev/null)

# ---- 复制扩展并打开 Firefox ----
print_step 5 "准备扩展并打开 Firefox" "Prepare the extension and open Firefox"
mkdir -p "$EXT_COPY_DIR"
rsync -a --delete-after "$EXT/dist/" "$EXT_COPY_DIR/" 2>/dev/null || cp -R "$EXT/dist/." "$EXT_COPY_DIR/"
printf '扩展目录（已复制到剪贴板）：%s\n' "$EXT_COPY_DIR"
printf '%s' "$EXT_COPY_DIR" | pbcopy 2>/dev/null || true
open -a Firefox "about:debugging#/runtime/this-firefox" 2>/dev/null || open -b org.mozilla.firefox "about:debugging#/runtime/this-firefox" 2>/dev/null || true

printf '\n'
print_pair "安装完成。剩余两步在 Firefox 里手动完成：" "Install done. Two manual steps remain in Firefox:"
printf '\n'
print_pair "1. 在 about:debugging#/runtime/this-firefox 点「临时载入附加组件」" "1. In about:debugging#/runtime/this-firefox click “Load Temporary Add-on”"
print_pair "2. 选择扩展目录（已复制到剪贴板）：" "2. Choose the extension directory (copied to clipboard):"
printf '   %s\n' "$EXT_COPY_DIR"
printf '\n'
print_pair "加载后重启 dsh web（如果尚未运行）：" "After loading, restart dsh web (if not already running):"
printf '   cd %s && pnpm start   （或 npx @deepseek-ai/dsh web）\n' "$ROOT"
printf '\n'
print_pair "验证：在 dsh GUI 中让 Agent 执行 browser_snapshot，应能读取当前 Firefox 页面。" \
          "Verify: ask the Agent to run browser_snapshot in the dsh GUI; it should read the active Firefox page."
