#!/bin/bash
# dsh-browser 一键安装：支持远程托管安装和本地 checkout 安装。
# dsh-browser one-command install: supports both managed remote installs and local checkout installs.
# 之后无需任何配置：扩展自动探测本机 dsh 并连接（回环免 token）。
# No further configuration is required: the extension discovers local dsh automatically and loopback connections require no token.
set -euo pipefail

REPOSITORY="Lum1104/dsh-browser"
REMOTE_REF="main"
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
MANAGED_ROOT="$DSH_HOME_DIR/dsh-browser"
MANAGED_MARKER="$MANAGED_ROOT/.managed-by-install-sh"
ARCHIVE_URL="https://github.com/$REPOSITORY/archive/refs/heads/${REMOTE_REF}.tar.gz"
BOOTSTRAP_TMP=""

print_step() {
  printf '\n[%s/4] %s\n' "$1" "$2"
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

has_workspace() {
  local candidate="$1"
  [ -f "$candidate/package.json" ] &&
    [ -f "$candidate/pnpm-lock.yaml" ] &&
    [ -f "$candidate/extensions/dsh-browser/package.json" ] &&
    [ -f "$candidate/packages/browser/bridge-browser/package.json" ] &&
    [ -f "$candidate/scripts/install.sh" ]
}

workspace_root_from_script() {
  local script_path="${BASH_SOURCE[0]:-}"
  local script_dir
  local candidate

  [ -n "$script_path" ] && [ -f "$script_path" ] || return 1
  script_dir="$(cd "$(dirname "$script_path")" && pwd)"
  candidate="$(cd "$script_dir/.." && pwd)"
  has_workspace "$candidate" || return 1
  printf '%s\n' "$candidate"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail_pair "$2" "$3"
}

cleanup_bootstrap() {
  if [ -n "$BOOTSTRAP_TMP" ] && [ -d "$BOOTSTRAP_TMP" ]; then
    rm -rf -- "$BOOTSTRAP_TMP"
  fi
}

bootstrap_remote_install() {
  local archive
  local source_dir
  local temp_base="${TMPDIR:-/tmp}"

  require_command curl "未找到 curl；请先安装 curl。" "curl was not found; install curl first."
  require_command tar "未找到 tar；请先安装 tar。" "tar was not found; install tar first."
  require_command rsync "未找到 rsync；请先安装 rsync。" "rsync was not found; install rsync first."

  if [ -d "$MANAGED_ROOT" ] && [ ! -f "$MANAGED_MARKER" ] && [ -n "$(ls -A "$MANAGED_ROOT" 2>/dev/null)" ]; then
    fail_pair \
      "$MANAGED_ROOT 已存在且不是脚本托管的安装目录；为避免覆盖，请移动该目录或在其中运行 ./scripts/install.sh。" \
      "$MANAGED_ROOT already exists and is not managed by this installer; move it or run ./scripts/install.sh inside it to avoid overwriting it."
  fi

  print_pair "未检测到完整的本地 checkout，切换到免 clone 安装。" "No complete local checkout was detected; switching to the clone-free install."
  print_pair "正在从 $REPOSITORY 的 $REMOTE_REF 分支下载安装文件……" "Downloading installation files from $REPOSITORY at ${REMOTE_REF}…"

  BOOTSTRAP_TMP="$(mktemp -d "$temp_base/dsh-browser-install.XXXXXX")"
  trap cleanup_bootstrap EXIT HUP INT TERM
  archive="$BOOTSTRAP_TMP/source.tar.gz"
  source_dir="$BOOTSTRAP_TMP/source"
  mkdir -p "$source_dir"

  curl --fail --location --silent --show-error --retry 3 "$ARCHIVE_URL" --output "$archive"
  tar -xzf "$archive" -C "$source_dir" --strip-components=1
  has_workspace "$source_dir" || fail_pair \
    "下载内容不完整，未修改现有安装。" \
    "The download is incomplete; the existing installation was not changed."

  mkdir -p "$MANAGED_ROOT"
  touch "$MANAGED_MARKER"
  rsync -a --delete-after \
    --exclude 'node_modules/' \
    --exclude '.managed-by-install-sh' \
    "$source_dir/" "$MANAGED_ROOT/"

  cleanup_bootstrap
  trap - EXIT HUP INT TERM
  print_pair "安装文件已同步到 ${MANAGED_ROOT}。" "Installation files are ready in $MANAGED_ROOT."
  exec /bin/bash "$MANAGED_ROOT/scripts/install.sh"
}

if ROOT="$(workspace_root_from_script)"; then
  :
else
  bootstrap_remote_install
fi

EXT="$ROOT/extensions/dsh-browser"
PLUGIN="$ROOT/packages/browser/bridge-browser"

require_command pnpm "未找到 pnpm；请先启用 Corepack 或安装 pnpm。" "pnpm was not found; enable Corepack or install pnpm first."
require_command rsync "未找到 rsync；请先安装 rsync。" "rsync was not found; install rsync first."

print_step 1 "构建浏览器桥" "Build the browser bridge"
(cd "$ROOT" && pnpm install --frozen-lockfile >/dev/null 2>&1)
(cd "$ROOT" && pnpm --filter @deepseek-ai/dsh-bridge-browser run build >/dev/null 2>&1)

print_step 2 "注册到本机 web profile" "Register with the local web profile"
(cd "$ROOT" && pnpm exec dsh plugin --profile web add "@deepseek-ai/dsh-bridge-browser@link:$PLUGIN" >/dev/null)

print_step 3 "构建 Chrome 扩展" "Build the Chrome extension"
(cd "$ROOT" && pnpm --filter dsh-browser-extension run build >/dev/null 2>&1)

print_step 4 "准备扩展并打开 Chrome" "Prepare the extension and open Chrome"
DIST_DIR="$DSH_HOME_DIR/browser-extension"
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
printf '• 启动固定版本：cd %q && pnpm start\n' "$ROOT"
printf '   Start the pinned version: cd %q && pnpm start\n' "$ROOT"
print_pair "• 或启动 npm 最新版本：npx @deepseek-ai/dsh web" "Or start the latest npm version: npx @deepseek-ai/dsh web"
