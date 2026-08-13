# dsh 浏览器操作插件（dsh-browser）

[English](README.en.md) | **中文**

<img width="1701" height="897" alt="image" src="https://github.com/user-attachments/assets/3b1f3a25-f962-4e02-a9ef-d23e0d01fc8e" />

让 dsh 的模型**直接读取并操作你在浏览器里打开的页面**：抓取页面内容、点击元素、填写表单、滚动与导航——全部在你自己的浏览器里执行，登录态、会话与 Cookie 完整保留。侧边栏面板是与模型对话的配套入口。

纯文本设计：DeepSeek 模型无视觉，页面以结构化文本呈现（带编号的交互元素清单），模型用编号精确定位并操作任意元素，整条管线**全程无截图**。

本仓库是独立 pnpm workspace：根包从私有 npm 安装已锁定的 `@deepseek-ai/dsh` 内测版，桥接插件对同一发布线声明 peer/dev 依赖，Chrome 扩展通过 workspace 依赖共享桥协议；无需 DeepSeek Harness 源码 checkout。

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
packages/browser/bridge-browser/
extensions/dsh-browser/
examples/browser-bridge.cordis.yml
scripts/install.sh
```

## 为什么这样设计

- **操作真实浏览器，而非无头浏览器**：页面就是用户正打开的那个，登录态/会话/Cookie 全保留——这是独立 Playwright 浏览器（如 `dsh-tool-browser`）做不到的。
- **纯文本适配无视觉模型**：编号元素清单 + 跨快照稳定编号（模型可以说"点 7 号"）+ delta 增量（省 token）+ 敏感值掩码。
- **隐私边界**：密码/卡号字段的值只以 `••••` 呈现，绝不离开页面。
- **安全**：桥通道 token 认证（首帧 `hello`、常量时间比对）；特权网关方法对非回环来源一律拒绝；扩展只操作活动标签页。

## 安装与使用（零配置）

前提：Node.js `^22.19` 或 `>=24`、Corepack/pnpm，以及可读取 `@deepseek-ai` 私有包的 npm 凭据。pnpm 11 不读取项目级认证字段，请在用户级 `~/.npmrc` 使用环境变量引用，真实令牌不得写进仓库：

```ini
@deepseek-ai:registry=https://registry.npmjs.org/
//registry.npmjs.org/:_authToken=${NPM_TOKEN}
```

**第一步：安装依赖与扩展**：

```sh
./scripts/install.sh
```

脚本按锁文件安装私有 npm 依赖、构建桥接插件、把本地插件链接到 dsh 的 `web` profile、构建扩展、复制到 `~/.dsh/browser-extension`，并打开 `chrome://extensions`；按提示开启开发者模式并加载该目录即可。

**第二步：启动 dsh**（在本仓库根目录下执行）：

```sh
pnpm start
```

默认端口为 3080；被占用时执行 `pnpm start -- --port <port>`。工具栏出现 DeepSeek 鲸鱼图标后，点击即可打开侧边栏。

**后续日常使用**无需重新安装扩展，只需在本仓库根目录启动 dsh：

```sh
pnpm start
```

**无需任何配置**：扩展自动探测本机 dsh 并连接（`/ext/bridge-config` 发现 + 回环免 token）。token/地址只在远程部署（`--host 0.0.0.0`）时才需要手动填写。

**第三步：开始使用**：打开任意普通的 `http://` 或 `https://` 页面，点击工具栏的 DeepSeek 鲸鱼图标打开侧边栏；状态显示「已连接」后，可以直接对话，也可以先点「读取页面」。页面即使早于扩展安装或重载就已经打开，也会在第一次操作时自动补加载内容脚本，无需刷新页面。`chrome://`、Chrome Web Store 等浏览器内置或受保护页面不能注入扩展脚本，因此不支持读取和操作。

更新代码后重新运行 `./scripts/install.sh`，再到 `chrome://extensions` 对「dsh 浏览器助手」点一次重新加载并重新打开侧边栏。Chrome 应加载脚本提示的稳定目录 `~/.dsh/browser-extension`；不要加载仓库中的源码目录 `extensions/dsh-browser/`。

## 开发

桥接插件和 Chrome 扩展都属于本仓库 workspace；所有命令均在本仓库根目录执行。首次开发安装运行 `pnpm install`。

```sh
pnpm run build
pnpm run typecheck
pnpm run test

pnpm --filter @deepseek-ai/dsh-bridge-browser run build
pnpm --filter @deepseek-ai/dsh-bridge-browser run typecheck
pnpm --filter @deepseek-ai/dsh-bridge-browser run test

pnpm --filter dsh-browser-extension run build
pnpm --filter dsh-browser-extension run test
```

注意：

- 启动前桥接插件必须已有 `lib/` 供 Loader 加载；`scripts/install.sh` 和根目录 `pnpm run build` 都会先构建插件再构建扩展。
- `@deepseek-ai/dsh` 及桥接插件的 SDK 依赖锁在同一内测发布线；升级时必须同时更新清单、锁文件并重跑根目录检查。

## 安全

- 桥路径在 `/api` 信任栅栏之外，自带 bearer token 认证
- 特权网关方法（`settings.*`/`credentials.*`/`host.open*`）对非回环来源一律拒绝
- 单活动连接；纯文本管线（无截图）；密码/卡号值永不回传
- 只操作活动标签页，绝不静默切页
