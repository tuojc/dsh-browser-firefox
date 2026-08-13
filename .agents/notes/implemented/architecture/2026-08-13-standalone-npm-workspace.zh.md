# Agent Note: 独立 npm 浏览器 workspace

Status: implemented

[English](2026-08-13-standalone-npm-workspace.md) | 中文

## 问题

浏览器桥仓库曾依赖同级的 DeepSeek Harness 源码 checkout，以提供 TypeScript 项目引用、workspace 依赖、测试解析与 `dsh` 可执行文件。这种拓扑使仓库无法独立针对已发布的私有 npm 版本完成安装、构建、测试或运行。

## 决策

该仓库是一个包含桥接包与 Chrome 扩展的 pnpm workspace。根 manifest（元数据清单）安装固定版本的 `@deepseek-ai/dsh` 候选发布版，桥接包则通过普通的对等依赖（peer dependency）与开发依赖使用与之匹配的已发布 `@deepseek-ai` 包。

已发布的 SDK 包使用带 scope 的 Cordis 与 Schemastery 标识。桥接源码与测试直接导入这些带 scope 的包，使 Cordis 服务声明合并与运行时类标识始终保持单一。桥接包遵循已发布的服务名称，包括 `webServer`、`workspaceRegistry`、`userQuestions` 与 `dsh-home-paths`。

扩展依赖本地桥接 workspace 包，并通过其 `./src/*` export 导入协议。根构建会先构建桥接包、再构建扩展；桥接包构建后的 `protocol` export 仍可供外部消费方使用。

已发布的 `dsh` 启动器解析外部插件时，以所选 profile 而非发起调用的 workspace 为准。因此，安装器会把构建后的本地桥接包链接到 `web` profile；启动命令则通过启动器的 `--patch` 选项应用仓库叠加配置。

私有注册表认证信息始终保留在仓库之外。项目 `.npmrc` 只选择注册表，不携带凭据；pnpm 11 从受信任的用户级 npm 配置中读取 `${NPM_TOKEN}` 认证引用。该 workspace 仅明确放行固定版本的 dsh 运行时与扩展构建所需的安装脚本。

## 替代方案

**保留指向宿主 checkout 的符号链接。**这样可以保留源码级开发方式，但会使外部仓库无法安装，并将每条命令与无关的父 workspace 绑定，从而无法验证 npm 发布版。

**在 Cordis 包过去不带 scope 的名称下为带 scope 的包设置别名。**这样可以保留 import 的拼写，但可能在已发布的 Harness 包旁边安装两个模块标识，破坏 Context 声明合并与类兼容性。直接导入带 scope 的包，可以保持唯一的运行时与类型标识。

## 验证

根目录的 `typecheck`、`build` 与 `test` 脚本覆盖两个 workspace 包。桥接套件会启动已发布的 Loader 与 Harness 服务，其 Chromium 测试通过构建后的扩展覆盖发现、WebSocket 认证、网关 RPC、延迟会话创建与 workspace 分组。一项启动冒烟测试会携带仓库叠加配置启动通过 npm 安装的 `web` profile，并读取发现端点。

## 后果

干净 checkout 无需 Harness 源码即可安装与运行，lockfile 会记录完整的私有 NPM 依赖图。更新 npm 发布版时，需要协同修改 manifest、API、lockfile 与端到端验证。安装要求具备私有注册表访问权限，并会执行由 dsh 运行时拉取、已明确加入允许清单的原生构建步骤。
