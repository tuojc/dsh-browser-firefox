# awesome-dsh-plugins 收录提交稿

> 按 [AdamPlatin123/awesome-dsh-plugins](https://github.com/AdamPlatin123/awesome-dsh-plugins) 的收录规范准备。
> 规范要点（来自 [PLUGINS.md](https://github.com/AdamPlatin123/awesome-dsh-plugins/blob/main/PLUGINS.md)）：
> - 分类体系：🔌 单插件 / 🧰 插件集 / 🎓 技能 / 📡 远程渠道 / 🛠 基础设施 / 💬 社区 / 🔬 研究 / ❓ 未分类
> - 插件名与 repo 名一致；npm scope 用 `@dsh-external/*`（勿占用 `@deepseek-ai/*`）
> - repo 打 `dsh-plugin` topic（打了之后每日 02:00 全量扫描也会自动收录，PR 登记更快）
> - 「运行级」一列由雷达 k8s 实测判定，新提交先留「待测」

## 一、PR 标题

```
Add dsh-browser-firefox to 🔌 单插件
```

## 二、PLUGINS.md 追加行（在 `## 🔌 单插件` 表格末尾追加）

> 表格列为：`| 插件 | 仓库 | 说明 | 运行级 |`
>
> ✅ 仓库地址已填好：`tuojc/dsh-browser-firefox`

```markdown
| dsh-browser-firefox | [tuojc/dsh-browser-firefox](https://github.com/tuojc/dsh-browser-firefox) | Firefox 浏览器控制（插件 + Firefox 扩展两件套）：DSH 插件经 token 认证 WebSocket 驱动用户自己的 Firefox，文本优先工具集——快照/点击/输入/按键/滚动/导航/前进后退/标签栈/取文本/等待，截图仅作视觉兜底且看完即清理；每会话一个 tab group（新旧标签全归组、检测复用不出组），新 tab 自动跟随，Firefox MV3 CSP 下 evaluate 用预编译操作（无任意 JS）；自 Lum1104/dsh-browser（MIT）移植，Firefox 扩展已在 AMO 上架：[DSH 浏览器助手](https://addons.mozilla.org/en-GB/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/) | 待测 |
```

## 三、PR 正文

```markdown
## 插件信息

- **名称**：dsh-browser-firefox
- **仓库**：https://github.com/tuojc/dsh-browser-firefox
- **分类**：🔌 单插件
- **topic**：已添加 `dsh-plugin`

## 说明

DSH 浏览器控制插件的 Firefox 版（一个 DSH 插件 + 一个 Firefox 扩展），自
[Lum1104/dsh-browser](https://github.com/Lum1104/dsh-browser)（MIT）移植。

- 插件经 token 认证 WebSocket 桥接，驱动用户自己的 Firefox（不远程控浏览器）
- 文本优先工具集：browser_snapshot / click / type / press / scroll / navigate /
  back / forward / reload / get_text / wait / list_tabs / evaluate（预编译操作）
- 截图仅作视觉兜底（browser.tabs.captureTab），临时文件看完自动清理
- 每个会话固定一个 tab group：导航新建 tab 归入组内，组内同 URL 复用，
  点击打开的新 tab 自动跟随
- Firefox MV3 兼容：原生 browser.* API（tabs.group / tabGroups，需 Firefox 140+），
  CSP 下无 eval / new Function

**Firefox 扩展已上架 Mozilla Add-ons（AMO）**：
https://addons.mozilla.org/en-GB/firefox/addon/dsh-%E6%B5%8F%E8%A7%88%E5%99%A8%E5%8A%A9%E6%89%8B/

## 运行级

新提交，留「待测」，由雷达 k8s 实测判定。
```

## 四、提交前检查清单

- [ ] repo 已公开并推送最新代码（当前本地 remote 还指向上游 `Lum1104/dsh-browser`，需先建自己的仓库）
- [ ] repo 加上 `dsh-plugin` topic
- [x] 表格行中的仓库地址已替换为 `tuojc/dsh-browser-firefox`
- [ ] 「运行级」列填「待测」（不要自填 ✅，由雷达实测判定）
- [ ] 如需更快收录：直接改 PLUGINS.md 对应表格提 PR；只打 topic 则等每日 02:00 自动扫描