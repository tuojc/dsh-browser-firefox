# dsh 浏览器操作插件（dsh-browser）

English | [中文](README.zh.md)

<img width="1687" height="879" alt="2026-08-06_17-10-14" src="https://github.com/user-attachments/assets/39e2f960-4002-4e5b-b02d-b015e348980c" />


让 dsh 的模型**直接读取并操作你在浏览器里打开的页面**：抓取页面内容、点击元素、填写表单、滚动与导航——全部在你自己的浏览器里执行，登录态、会话与 Cookie 完整保留。侧边栏面板是与模型对话的配套入口。

纯文本设计：DeepSeek 模型无视觉，页面以结构化文本呈现（带编号的交互元素清单），模型用编号精确定位并操作任意元素，整条管线**全程无截图**。

本仓库遵循 dsh-external 内测生态惯例：**只含插件本身，不含 DeepSeek Harness SDK 源码**；SDK 包全部以 `peerDependencies` 声明，运行时由宿主 Harness workspace 提供。

## 核心能力

| 能力 | 工具 | 说明 |
|---|---|---|
| 读取页面 | `browser_snapshot` | 结构化文本快照：标题/URL/正文/编号交互清单/表单字段（敏感值掩码）；`delta: true` 只返回变化 |
| 点击元素 | `browser_click` | 按编号点击链接/按钮/复选框等 |
| 填写表单 | `browser_type` | 输入文本（React/Vue 受控组件兼容），`replace` 清空重填 |
| 按键 | `browser_press` | 键盘事件（Enter/Tab/Escape/方向键…） |
| 滚动 | `browser_scroll` | 视口滚动（up/down/top/bottom） |
| 页面导航 | `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | 当前标签页内导航，保留登录态 |
| 读取区域 | `browser_get_text` | 懒加载内容 / 局部文本 |
| 等待稳定 | `browser_wait` | 页面加载与渲染稳定检测 |

## 组成

```
packages/browser/bridge-browser/    桥插件：token 认证 WS 通道 + browser_* 工具 + 线协议
extensions/dsh-browser/             Chrome MV3 扩展：content script 在真实页面执行动作 + 侧边栏对话界面
examples/browser-bridge.cordis.yml  dsh web overlay 示例（--config 引入）
scripts/install.sh                  一键安装脚本
```

## 为什么这样设计

- **操作真实浏览器，而非无头浏览器**：页面就是用户正打开的那个，登录态/会话/Cookie 全保留——这是独立 Playwright 浏览器（如 `dsh-tool-browser`）做不到的。
- **纯文本适配无视觉模型**：编号元素清单 + 跨快照稳定编号（模型可以说"点 7 号"）+ delta 增量（省 token）+ 敏感值掩码。
- **隐私边界**：密码/卡号字段的值只以 `••••` 呈现，绝不离开页面。
- **安全**：桥通道 token 认证（首帧 `hello`、常量时间比对）；特权网关方法对非回环来源一律拒绝；扩展只操作活动标签页。

## 安装与使用（零配置）

前提：`dsh` 已安装并可用；本仓库位于宿主 SDK checkout 的 `dsh-browser/` 子目录。

**第一步：启动 dsh**（在本仓库根目录下执行；`--config` 路径相对当前目录）：

```sh
dsh web --config examples/browser-bridge.cordis.yml
```

默认端口 3080；被其他 `dsh web` 占用时，追加 `--port <端口>` 换一个。

**第二步：安装扩展（一条命令）**：

```sh
./scripts/install.sh
```

脚本会构建插件与扩展、复制到 `~/.dsh/browser-extension`、打开 `chrome://extensions`；按提示开启开发者模式并加载该目录即可。工具栏出现 DeepSeek 鲸鱼图标，点击打开侧边栏。

**无需任何配置**：扩展自动探测本机 dsh 并连接（`/ext/bridge-config` 发现 + 回环免 token）。token/地址只在远程部署（`--host 0.0.0.0`）时才需要手动填写。

## 开发

插件包是宿主 SDK workspace 的成员（宿主 `pnpm-workspace.yaml` 经 `packages/browser/bridge-browser` 符号链接挂载，peer 依赖由宿主提供），插件包命令须在**宿主 checkout 根目录**（即本仓库的上一级 `..`）下执行；Chrome 扩展完全独立，命令在**本仓库根目录**下执行。

```sh
# 插件包：在宿主 checkout 根目录执行（依赖随宿主 workspace 安装）
pnpm --filter @deepseek-ai/dsh-bridge-browser run build       # tsc -b + tsdown，产出 lib/
pnpm --filter @deepseek-ai/dsh-bridge-browser run typecheck   # tsc -b（extends 宿主 tsconfig.base）
pnpm --filter @deepseek-ai/dsh-bridge-browser run test        # vitest（paths 指向宿主源码）

# 扩展：在本仓库根目录执行（首次克隆先 pnpm install）
pnpm --filter dsh-browser-extension run build
pnpm --filter dsh-browser-extension run test
```

注意：

- 宿主使用前插件包必须先构建（`lib/` 供 Loader 加载）；`scripts/install.sh` 已代为执行，日常使用无需手动构建。
- 宿主 checkout 以 `dsh-browser/` 存在为前提（符号链接悬空时宿主不受影响）；不需要插件时移走 `dsh-browser/` 并移除该符号链接即可。

## 安全

- 桥路径在 `/api` 信任栅栏之外，自带 bearer token 认证
- 特权网关方法（`settings.*`/`credentials.*`/`host.open*`）对非回环来源一律拒绝
- 单活动连接；纯文本管线（无截图）；密码/卡号值永不回传
- 只操作活动标签页，绝不静默切页
