# dsh 浏览器操作

[English](README.md) | **中文**

<img width="1701" height="897" alt="dsh 浏览器操作" src="https://github.com/user-attachments/assets/3b1f3a25-f962-4e02-a9ef-d23e0d01fc8e" />

把 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 连接到你正在使用的 Chrome 标签页。模型可以读取页面内容、点击控件、填写表单、滚动与导航，同时保留登录态、会话和 Cookie。侧边栏提供对话界面。

`dsh` 是由 DeepSeek AI 开发的开源、插件化 agent harness（智能体框架）。本仓库将配套的浏览器桥插件与 Chrome MV3 扩展组成一个独立的 pnpm workspace。

整个集成采用纯文本设计：页面会转换为结构化文本和带编号的交互元素清单，模型通过编号定位元素。面向模型的流水线不会传入截图。

workspace 固定使用经过验证、已公开发布的 `@deepseek-ai/dsh` 版本，保证安装结果可复现。用户无需检出 DeepSeek Harness 源码、无需从父目录读取依赖，也无需配置 npm 凭据。DeepSeek Harness 目前处于开发者预览阶段，升级时可能需要同步调整依赖与 API。

> [!IMPORTANT]
> npm 上未加 scope 的 [`dsh-browser`](https://www.npmjs.com/package/dsh-browser) 包属于另一个项目，与本仓库无关。本项目目前没有发布 npm 包，请使用下文提供的安装方式。

## 性能基准

在 2026 年 8 月 18 日完成的 60 次配对端到端评测中，两个后端分配到的 30 次运行均全部成功；dsh 浏览器操作使用了更少的模型/工具轮次，并以更短时间完成任务：

| 后端 | 成功率 | 平均端到端耗时 | 平均浏览器工具调用 |
|---|---:|---:|---:|
| **dsh 浏览器操作** | **30/30** | **5.32 秒** | **3.4** |
| 对齐工具契约的 Playwright 基线 | 30/30 | 6.67 秒 | 4.7 |

Playwright / 扩展的配对耗时比为 **1.24**（95% CI **1.16–1.34**）：Playwright 耗时约多 24%；等价地说，dsh 浏览器操作将延迟降低约 20%，每个任务平均节省 1.35 秒。评测使用 6 个浏览器任务、5 个确定性 seed、相同的 DSH profile 与模型（`deepseek-v4-flash`），并通过独立页面状态验证结果。详见[评测方法与复现说明](benchmark/README.md)。

## 核心能力

| 能力 | 工具 | 说明 |
|---|---|---|
| 读取页面 | `browser_snapshot` | 结构化文本快照：标题/URL/正文/编号交互清单/表单字段（敏感值掩码）；`delta: true` 只返回变化 |
| 点击元素 | `browser_click` | 按编号点击链接/按钮/复选框等 |
| 填写表单 | `browser_type` | 输入文本（React/Vue 受控组件兼容），`replace` 清空重填 |
| 按键 | `browser_press` | 键盘事件（Enter/Tab/Escape/方向键…） |
| 滚动 | `browser_scroll` | 视口滚动（up/down/top/bottom） |
| 页面导航 | `browser_navigate` / `browser_back` / `browser_forward` / `browser_reload` | 受控标签页内导航，保留登录态 |
| 读取区域 | `browser_get_text` | 懒加载内容 / 局部文本 |
| 等待稳定 | `browser_wait` | 页面加载与渲染稳定检测 |

## 组成

```
packages/browser/bridge-browser/
  cordis.patch.yml
extensions/dsh-browser/
scripts/install.sh
```

## 为什么这样设计

- **使用你的真实浏览器，而不是无头副本**：模型操作你已经打开的页面，登录态、会话和 Cookie 均会保留。
- **纯文本模型接口**：编号控件、跨快照稳定 ID、delta 更新和敏感值掩码，使模型无需视觉也能操作页面。
- **收窄隐私边界**：密码和支付卡字段始终显示为 `••••`，字段值不会离开页面。
- **受保护的桥连接**：远程连接使用认证握手，特权网关方法拒绝非回环调用方，扩展把工具绑定到一个由用户控制的标签页。

## 安装与使用（零配置）

前提：Node.js `^22.19` 或 `>=24`、Corepack/pnpm 和 Google Chrome。所需的 `@deepseek-ai` 包均已发布到公共 npm 注册表，安装不需要 npm token。

**第一步：安装桥插件与扩展**。推荐命令无需安装 Git，也无需提前 clone：

```sh
curl -fsSL https://raw.githubusercontent.com/Lum1104/dsh-browser/refs/heads/main/scripts/install.sh | bash
```

远程安装器会把 `main` 下载到脚本托管目录 `~/.dsh/dsh-browser`，然后按锁文件安装固定版本的公共 npm 依赖、构建桥插件、把它的官方 bundle 注册到 dsh 本机的 `web` profile、构建扩展、复制到 `~/.dsh/browser-extension`，并打开 `chrome://extensions`。按提示开启开发者模式并加载扩展目录即可。再次运行同一条命令会更新托管安装；如需修改源码，请使用 clone。

**安装前 dsh 已在运行？装完请重启 dsh。** 安装器把桥接 bundle 注册进 dsh 本机的 `web` profile，而 dsh 只在启动时加载 profile。安装前就已启动的实例不会带上桥接，因此侧边栏会一直显示「未连接」——即使扩展已正确加载。停掉该实例并按第二步重新启动即可；扩展会自动发现桥接，无需重新配置。

开发者也可以 clone 仓库，并在任意 checkout 中运行同一个安装器。该模式直接使用当前分支，不会下载或覆盖源码：

```sh
git clone https://github.com/Lum1104/dsh-browser.git
cd dsh-browser
./scripts/install.sh
```

**第二步：启动 dsh**。托管安装可使用其中固定的版本：

```sh
cd ~/.dsh/dsh-browser && pnpm start
```

如果使用 clone，请改为在仓库根目录运行 `pnpm start`。

或者直接运行 npm 上的最新公开版本：

```sh
npx @deepseek-ai/dsh web
```

两种命令都会从本机 `web` profile 加载同一个浏览器 bundle。默认端口为 3080；被占用时执行 `pnpm start -- --port <port>` 或 `npx @deepseek-ai/dsh web --port <port>`。工具栏出现 DeepSeek 鲸鱼图标后，点击即可打开侧边栏。

**后续日常使用**无需重新安装扩展，执行上述任一启动命令即可。

**本机使用无需任何配置**：扩展通过 `/ext/bridge-config` 自动发现 dsh，回环连接无需桥接 token。这个运行时安全 token 与 npm 认证无关；只有使用 `--host 0.0.0.0` 远程部署时才需要配置地址和桥接 token。

**第三步：开始使用**：打开任意普通的 `http://` 或 `https://` 页面，点击工具栏的 DeepSeek 鲸鱼图标打开侧边栏；状态显示「已连接」后，可以直接对话，也可以先点「读取页面」。页面即使早于扩展安装或重载就已经打开，也会在第一次操作时自动补加载内容脚本，无需刷新页面。`chrome://`、Chrome Web Store 等浏览器内置或受保护页面不能注入扩展脚本，因此不支持读取和操作。

更新托管安装时，再次运行同一条 `curl | bash` 命令。更新 clone 时，拉取或切换到所需版本，再运行 `./scripts/install.sh`。然后到 `chrome://extensions` 对「dsh 浏览器助手」点一次重新加载并重新打开侧边栏。Chrome 应加载脚本提示的稳定目录 `~/.dsh/browser-extension`；不要加载仓库中的源码目录 `extensions/dsh-browser/`。若 dsh web 正在运行，也请重启它，使其重新加载更新后的 `web` profile（见「故障排查」）。

## 故障排查

**侧边栏一直显示「未连接」**

- 确认本机 dsh web 正在运行（默认 `http://127.0.0.1:3080`）。
- 确认桥接已加载：浏览器打开 `http://127.0.0.1:3080/ext/bridge-config`，应返回类似 `{"wsUrl":"ws://127.0.0.1:3080/ext/bridge"}` 的 JSON。如果返回的是网页而不是 JSON，说明当前运行的 dsh 早于桥接注册——重启 dsh 并刷新页面即可，扩展会自动重连。
- 扩展会自动探测 3080/3081/3090 端口。若 dsh 运行在其它端口，或使用 `--host 0.0.0.0` 远程部署，请在侧边栏设置中填写地址与桥接 token。

## 开发

桥接插件和 Chrome 扩展都属于本仓库 workspace；所有命令均在本仓库根目录执行。首次开发安装运行 `pnpm install`。

```sh
pnpm run build
pnpm run typecheck
pnpm run test

pnpm --filter @yuxianglin/dsh-bridge-browser run build
pnpm --filter @yuxianglin/dsh-bridge-browser run typecheck
pnpm --filter @yuxianglin/dsh-bridge-browser run test

pnpm --filter dsh-browser-extension run build
pnpm --filter dsh-browser-extension run test
```

注意：

- 启动前桥接插件必须已有 `lib/` 供 Loader 加载；`scripts/install.sh` 和根目录 `pnpm run build` 都会先构建插件再构建扩展。
- `@deepseek-ai/dsh` 与桥接插件的依赖固定在同一条经过验证的公开发布线上；升级时必须同时更新 manifest、锁文件并重跑根目录检查。

## 安全

- 桥路径在 `/api` 信任栅栏之外，自带 bearer token 认证。
- 特权网关方法（`settings.*`/`credentials.*`/`host.open*`）对非回环来源一律拒绝。
- 单活动连接；纯文本管线（无截图）；密码和卡号值永不回传。
- 助手开始工作时会绑定当时的活动标签页（提交提示时绑定；直接调用浏览器工具时则在首次调用绑定）。用户手动切页后，后续浏览器操作会暂停，侧栏会询问让助手继续原页面还是跟随新页面；选择原页面后允许在后台继续，但扩展绝不静默改绑或切换用户正在看的页面。受控标签页关闭后也会暂停，直到用户显式选择当前页。
- 网页文字会标记为不可信输入。默认「自动共享」只按需读取受控标签页且不额外弹窗；对隐私敏感时可选择「每次询问」，或用「关闭」完全阻断读取。在「每次询问」模式下，读取弹窗可以仅允许一次，也可以持久切回自动读取；之后仍可在设置中关闭。读取的页面文字会发送给当前选择的模型。
- 点击、输入、按键、导航、历史跳转和刷新默认失败关闭，必须由用户批准。可以只在当前侧栏会话中信任单个 origin（最后一个侧栏关闭或 Service Worker 重启即清空）；永久信任需在设置中显式管理。显式跨域 `browser_navigate` 和未知目标的历史跳转始终重新询问。
