# dsh-browser-firefox

Firefox 版的 DeepSeek Harness 浏览器操作插件，让模型直接读取并操作你**正在使用的 Firefox 标签页**，登录态、会话与 Cookie 全程保留。

- **后台静默操作**：导航与点击链接一律新建标签页（不覆盖当前页、不抢焦点），Agent 在后台完成操作。
- **常驻运行**：扩展加载后即常驻并保持桥接连接，无需先点开侧边栏。
- **会话级分组**：每个 dsh 对话固定一个带颜色的标签页组，组名取自目标域名（如 `bilibili.com`）。

本项目从 [Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser)（MIT 许可）移植为 Firefox 版，保留原作者版权（见 [LICENSE](./LICENSE)）。

---

## 这是什么

[dsh](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）是 DeepSeek 的开源插件式 Agent 框架。本仓库提供配套的两个组件：

| 组件 | 位置 | 作用 |
|---|---|---|
| **bridge 插件** | `plugin/` | 装在 dsh web 里的本地服务端（WebSocket 桥） |
| **Firefox 扩展** | `extension/` | 装在 Firefox 里，实际操作浏览器标签页 |

集成是**纯文本**的：页面被转成带编号交互元素清单的结构化文本，模型按编号操作元素。截图只是视觉兜底——保存为 PNG 文件交给视觉工具分析，不以图片形式进入对话上下文。

## 快速开始

### 第 1 步：安装 bridge 插件

```sh
dsh plugin --profile web add dsh-browser-firefox@latest
```

**安装后重启 `dsh web` 生效。**

### 第 2 步：安装 Firefox 扩展

扩展已上架 Firefox 扩展商店，直接安装👉 [DSH 浏览器助手 - addons.mozilla.org](https://addons.mozilla.org/zh-CN/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/)（也可在 AMO 搜索「dsh 浏览器助手」）。

### 第 3 步：填写 token（仅首次）

```sh
cat ~/.dsh/ext-bridge-token   # 复制输出
```

打开扩展侧边栏 → 右上角 ⚙️ 设置 → 把复制的内容粘贴到 **Token** 一栏 → 保存并连接。（桥地址留空即可，自动探测本机 3080/3081/3090 端口。）

> **为什么 Firefox 必须填 token（0.3.1 起，与上游同步的安全收紧）**：Firefox 扩展的 `moz-extension://` Origin 是每次安装随机生成的 UUID，无法据此辨认扩展身份，所以 bridge 要求 Firefox 客户端一律出示 token（Chrome 扩展的回环免 token 不受影响）。没填或填错时，面板会显示「需要 Token」横幅引导你完成这一步。

### 验证

```sh
# bridge 发现端点应返回 WS 地址
curl -s http://127.0.0.1:3080/ext/bridge-config
# => {"wsUrl":"ws://127.0.0.1:3080/ext/bridge"}
```

## 功能

| 能力 | 工具 | 说明 |
|---|---|---|
| 读取页面 | `browser_snapshot` | 结构化文本快照：标题/URL/正文/编号控件/表单字段（敏感值掩码）；`delta: true` 只返回变化 |
| 点击元素 | `browser_click` | 按编号点击；若是 http/https 链接则**后台新开标签页**，否则普通点击 |
| 填写表单 | `browser_type` | 输入文本；`replace` 先清空再输入 |
| 按键 | `browser_press` | Enter / Tab / Escape / 方向键等 |
| 滚动 | `browser_scroll` | 视口滚动（up/down/top/bottom） |
| 导航 | `browser_navigate` | **后台静默新建标签页**打开 URL，不覆盖当前页 |
| 历史 | `browser_back` / `browser_forward` | 当前标签页内后退/前进 |
| 刷新 | `browser_reload` | 重新加载当前标签页 |
| 读区域 | `browser_get_text` | 懒加载内容 / 局部文本 |
| 等待 | `browser_wait` | 页面加载与渲染稳定检测 |
| 截图 | `browser_screenshot` | 按需截图（视觉兜底），返回 PNG 路径；临时保存、多张并存、超 20 张自动删最旧 |
| 清理截图 | `browser_clear_screenshots` | 删除全部临时截图，看完后调用避免残留 |
| 执行 JS | `browser_evaluate` | 页面上下文执行任意 JS（支持 async/await），snapshot/click 覆盖不到时的逃逸舱 |
| 列出标签页 | `browser_list_tabs` | 列出当前会话分组内的所有标签页（`*` 标记工作标签页） |

### 后台静默操作

`browser_navigate` 与点击链接都用 `active:false` 新建标签页——浏览器**停留当前页、不切走**。扩展内部维护「工作标签页」，后续 `browser_snapshot`/点击等操作静默作用在这个后台标签页上。

### 常驻运行

Firefox MV3 的 background 默认是 event page，空闲 45-90 秒会休眠。本扩展用 3 个错峰的 alarm（每 20 秒）持续保活，使 background 常驻、WebSocket 桥常连——Agent 随时能操作浏览器，无需先点侧边栏。

### 配合视觉工具（截图）

当页面内容是图片/公式/验证码等无法用文本表达时，模型可调 `browser_screenshot` 截图，得到 PNG 绝对路径后交给任意视觉工具（如 vision_glance）分析。截图保存在 session workspace 的 `.dsh-browser-tmp/` 目录，多张并存、最多 20 张（超出自动删最旧）；看完后调 `browser_clear_screenshots` 清理。

### 会话级标签页组

每个 dsh **会话固定一个 Firefox 标签页组**：该会话内导航/点击链接新建的标签页都归入同一组，颜色自动分配（蓝/绿/红/紫…循环），**组名取自目标域名**（去 `www.` 前缀，如 `bilibili.com`）——不同会话不同颜色、不同域名，连续性工作聚在一起。

## 架构

```
sidebar panel (React) ◄─port─► background script ◄─WS─► dsh bridge 插件
                                    │
                 tabs.sendMessage (DSH_ACTION / DSH_RESOLVE_ELEMENT)
                                    ▼
                           content script (快照 / 动作 / 元素解析 / 隐私)
```

- **bridge 插件**（`plugin/`）：token 认证的 WebSocket 服务端、工具分发、会话标识透传；挂载 `/ext/bridge`（WS）与 `/ext/bridge-config`（地址自动发现）。
- **扩展 background**（`extension/src/background/`）：桥连接（指数退避重连 + alarm 保活）、工具分流（导航/链接在 background 新建标签页并分组，其余分发到 content script）、标签页组管理。
- **content script**（`extension/src/content/`）：纯文本快照、稳定编号、元素解析、动作执行、敏感字段掩码。
- **panel**（`extension/src/panel/`）：React 侧边栏对话界面，Markdown 渲染（已消毒）。
- **协议**：`plugin/src/protocol.ts` 是两端共享的帧格式定义（`tool.call` 帧含 `expiresAt`/`sessionId`/`title`；超时或取消时服务端以 `tool.cancel` 撤回调用）。

## 从源码构建

前置要求：Node.js `>=20`、pnpm 11.x、Firefox `>=140`（标签页组需要）。

> **从源码 clone 后**，先执行 `cp extension/manifest.example.json extension/manifest.json`，并把其中 `gecko.id` 改成你自己的唯一邮箱（提交 AMO 签名需要，仓库不含个人 manifest）。

```sh
pnpm install
pnpm build   # 依次构建 bridge 插件 + 扩展
```

构建产物：

| 组件 | 分发方式 | 本地产物 |
|---|---|---|
| 插件 | 发布到 npm（`dsh-browser-firefox`），用户一行命令安装 | `plugin/lib/`（构建输出） |
| 扩展 | 提交 AMO（Firefox 扩展商店） | `extension/dsh-browser-firefox.zip`（安装包）、`extension/dsh-browser-firefox-extension-source.zip`（AMO 审核用源码包） |

## 目录结构

```
plugin/                                 # dsh 侧 bridge 插件（npm 包 dsh-browser-firefox）
  src/                                  # 源码（协议 / 服务端 / 工具）
  lib/                                  # 构建产物
  cordis.patch.yml                      # 插件注册配置
extension/                              # Firefox 扩展
  src/background/                       # 桥连接 / 工具分流 / 分组管理
  src/content/                          # 快照 / 动作 / 元素解析
  src/panel/                            # React 侧边栏
  src/browser.d.ts                      # browser.* 类型声明
  manifest.json                         # Firefox MV3 清单
  dist/                                 # 构建产物
  dsh-browser-firefox.zip               # 加载 / 提交包
  dsh-browser-firefox-extension-source.zip  # 源码包
scripts/install-firefox.sh              # 一键安装（跨电脑）
README.md / PRIVACY.md / LICENSE
package.json / pnpm-workspace.yaml / pnpm-lock.yaml
```

## 安全

- bridge 路径自带 token 认证；非回环远程拒绝特权方法（`settings/credentials/open-*`）。
- Chrome 扩展本地回环免 token 依赖 `chrome-extension://` Origin（网页无法伪造）；`moz-extension://` Origin 是随机 UUID、不构成身份边界，故 Firefox 一律要求 token。
- 密码、支付卡号等敏感字段在快照中一律掩码为 `••••`。
- 导航/点击链接只在后台新建标签页，不覆盖、不抢用户当前页面。

## 许可

MIT © 2026 Yuxiang Lin（原 [Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser) 作者），本 Firefox 移植版保留原许可与版权声明。
