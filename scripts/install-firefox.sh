#!/bin/bash
# dsh-browser-firefox 一键安装脚本（跨电脑 / 重新部署用）
# 完成：安装 bridge 插件到 dsh web profile → 打开 Firefox 扩展商店页 → 打印 token 设置指引
set -euo pipefail

print_step() {
  printf '\n[%s/3] %s\n' "$1" "$2"
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

# ---- 前置依赖检查 ----
print_step 1 "检查前置依赖" "Check prerequisites"
if command -v dsh >/dev/null 2>&1; then
  print_pair "✓ dsh 已安装：$(dsh --version 2>/dev/null || echo '?')" "dsh found."
else
  fail_pair "未找到 dsh；请先执行：npm install -g @deepseek-ai/dsh" \
            "dsh not found; run: npm install -g @deepseek-ai/dsh"
fi

# ---- 安装 bridge 插件到 web profile ----
print_step 2 "安装 bridge 插件到 dsh web profile" "Install the bridge plugin into the web profile"
dsh plugin --profile web add dsh-browser-firefox@latest
print_pair "✓ 插件已安装（升级也是同一条命令）" "Plugin installed (re-run the same command to upgrade)."

# ---- 打开扩展商店页并打印 token 指引 ----
print_step 3 "安装 Firefox 扩展并填写 token" "Install the Firefox extension and set the token"
AMO_URL='https://addons.mozilla.org/zh-CN/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/'
open -a Firefox "$AMO_URL" 2>/dev/null || open -b org.mozilla.firefox "$AMO_URL" 2>/dev/null || printf '请手动打开：%s\n' "$AMO_URL"

printf '\n'
print_pair "剩余两步手动完成：" "Two manual steps remain:"
printf '\n'
print_pair "1. 重启 dsh web 使插件生效（首次启动会生成 ~/.dsh/ext-bridge-token）：" \
          "1. Restart dsh web (first run generates ~/.dsh/ext-bridge-token):"
printf '   dsh web\n'
printf '\n'
print_pair "2. 在 Firefox 扩展侧边栏 → 设置 → Token 粘贴令牌内容：" \
          "2. In the extension sidebar → Settings → Token, paste:"
printf '   cat ~/.dsh/ext-bridge-token\n'
printf '\n'
