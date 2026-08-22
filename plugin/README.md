# dsh-browser-firefox

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）的 Firefox 浏览器操作 bridge 插件。与 Firefox 扩展「[DSH 浏览器助手](https://addons.mozilla.org/zh-CN/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/)」配套使用，让模型读取并操作你正在使用的 Firefox 标签页（登录态保留、后台静默新开标签页、会话级标签页组）。

完整文档与源码：<https://github.com/tuojc/dsh-browser-firefox>

## 安装

```sh
dsh plugin --profile web add dsh-browser-firefox@latest
```

安装后重启 `dsh web` 生效。首次启动会在 `~/.dsh/ext-bridge-token` 生成 bearer token（`0600` 权限）。

## 配套扩展与 token

1. 从 AMO 安装 Firefox 扩展：[DSH 浏览器助手](https://addons.mozilla.org/zh-CN/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/)。
2. 打开扩展侧边栏 → 设置 → 把 `~/.dsh/ext-bridge-token` 的内容粘贴到 Token 一栏 → 保存并连接（桥地址留空，自动探测本机 3080/3081/3090 端口）。

> Firefox 的 `moz-extension://` Origin 是每次安装随机生成的 UUID，不构成身份边界，因此 0.3.1 起 Firefox 客户端必须出示 token（与上游 [Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser) 同步的安全收紧）。

## 提供的工具

`browser_snapshot`（结构化文本快照）、`browser_click`、`browser_type`、`browser_press`、`browser_scroll`、`browser_navigate`（后台新标签页）、`browser_back` / `browser_forward` / `browser_reload`、`browser_get_text`、`browser_wait`、`browser_evaluate`、`browser_screenshot`（视觉兜底）、`browser_clear_screenshots`、`browser_list_tabs`。

纯文本集成：页面渲染为带编号交互元素清单的文本；截图只保存为文件交给视觉工具，不进入模型上下文。

## 许可

MIT。本项目是 [Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser) 的 Firefox 移植版，保留原作者版权。
