/**
 * 宿主审批（申请权限）在侧边栏的展示与回执解释。
 *
 * @module
 */

import type { PendingApproval } from './events.ts'
import { isRecord } from './json.ts'

/** 侧边栏可回传的决策（宿主审批结果集只有这两个是用户动作）。 */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/**
 * 解释 `bridge/approvalDecision` 的 rpc 回执。
 * - accepted：桥已受理并结算宿主瀑布；
 * - not-pending：审批已失效（在别处决定、被宿主取消）；
 * - bad-decision：负载被拒；
 * - retry：无法识别的回执（网络/旧插件）。
 */
export function approvalReceiptReason(value: unknown): 'accepted' | 'not-pending' | 'bad-decision' | 'retry' {
  if (!isRecord(value)) return 'retry'
  if (value.accepted === true) return 'accepted'
  if (value.accepted === false && value.reason === 'not-pending') return 'not-pending'
  if (value.accepted === false && value.reason === 'bad-decision') return 'bad-decision'
  return 'retry'
}

/** 卡片正文：工具名 + 原因（缺失时给出中性说明）。 */
export function approvalReasonText(approval: PendingApproval): string {
  const reason = approval.reason?.trim()
  return reason !== undefined && reason !== '' ? reason : '宿主需要在执行前得到你的确认。'
}

