# Agent Note: 浏览器 profile bundle

Status: implemented

[English](2026-08-14-browser-profile-bundle.md) | 中文

## 问题

把桥接包装成普通 profile 依赖只能让 JavaScript 可解析，不能把它挂载到 `web` 组合。仓库曾用根目录 `--patch` 文件补足这一步，因此 `pnpm start` 可以加载桥接插件，标准的 `npx @deepseek-ai/dsh web` 命令却不能。两种启动器的行为并不一致，而且桥接插件的激活契约位于包外。

## 决策

桥接包把 `dsh.bundle.patch` 声明为 `./cordis.patch.yml`，导出该文件并将其纳入发布文件集合。安装器把链接形式的包添加到本机 `web` profile，让 Harness profile 管理器注册它的 patch 层。

`pnpm start` 运行 workspace 固定版本的 `dsh web`，`npx @deepseek-ai/dsh web` 则运行 npm 当前的公开版本。安装完成后，两种命令都会解析同一个本机 profile bundle，无需仓库相对路径形式的 `--patch` 参数。

桥接包通过 workspace 脚本路径调用 `tsdown`。运行时配置、构建工具与插件代码全部位于本仓库或其声明的包依赖图中；任何命令都不会从父 checkout 或父目录的 `node_modules` 解析依赖。

## 替代方案

**保留根叠加配置并为 npx 记录额外参数。**这样会继续维护两条激活路径，也无法让标准 npm 命令按照 Harness 的文档直接工作。

**在根目录与包内各复制一份 patch。**重复配置可能产生漂移或把插件挂载两次。profile 层只由该包统一持有。

## 验证

使用干净 lockfile 安装检查公开发布版的依赖图；通过包组装确认包含 `cordis.patch.yml`。在隔离的 home 中执行启动冒烟测试：把 bundle 添加到全新的 `web` profile，分别启动 `pnpm start` 与 `npx @deepseek-ai/dsh web`，并要求 `/ext/bridge-config` 成功响应。

## 后果

每个需要浏览器操作能力的 dsh home 都必须先运行一次安装器。未指定版本的 npx 命令会跟随 npm 当前 dist-tag，因此每次 Harness 发布后仍需验证兼容性；workspace 固定版本的命令继续作为可复现路径。
