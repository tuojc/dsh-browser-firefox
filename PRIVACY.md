# 隐私说明（Privacy Policy）

## 数据收集声明

本扩展（dsh 浏览器助手，Firefox 版）**不收集、不存储、不上传任何用户数据到第三方服务器**。

- **manifest 声明**：`data_collection_permissions.required = ["none"]`（不收集数据）。
- **网页内容**：仅在用户主动调用工具（如 `browser_snapshot`）时读取，通过**本机回环连接**（`127.0.0.1`）发送给本地运行的 DeepSeek Harness，再由用户在 Harness 中配置的模型 API 处理。网页内容不离开用户的设备与用户主动选择的模型服务之外。
- **认证信息**：bridge 的 bearer token 生成于本机 `~/.dsh/ext-bridge-token`（`0600` 权限），仅用于本地扩展 ↔ 本地 Harness 的鉴权，不收集、不上传。
- **本地存储**：扩展仅在本机 `browser.storage.local` 保存设置（桥地址、token、页面共享偏好），不涉及远程。
- **敏感字段**：密码、支付卡号等敏感输入在快照中一律掩码为 `••••`，不出页面。

## 安全

- 桥路径自带 token 认证；非回环远程拒绝特权方法。
- 本地免 token 依赖 `moz-extension://` / `chrome-extension://` Origin（网页无法伪造）。

## 联系方式

（提交 AMO 时请填写你的联系方式。）
