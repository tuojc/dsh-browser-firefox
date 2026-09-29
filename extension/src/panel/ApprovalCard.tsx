import type { PendingApproval } from './events.ts'
import { approvalReasonText, type ApprovalDecision } from './approvals.ts'

/**
 * 宿主审批（申请权限）卡片：桥认领 `approval/request` 瀑布后，用户在侧边栏
 * 直接「允许一次」或「拒绝」，不必切到 dsh web。
 */
export function ApprovalCard({
  approval,
  submitting,
  onDecide,
}: {
  approval: PendingApproval
  submitting: boolean
  onDecide: (decision: ApprovalDecision) => void
}): React.JSX.Element {
  return (
    <section className="approval-card" aria-labelledby="approval-card-title" aria-live="polite">
      <header className="approval-heading">
        <span className="approval-mark" aria-hidden="true">!</span>
        <div>
          <span className="eyebrow">等待你的许可</span>
          <h2 id="approval-card-title">助手请求权限</h2>
        </div>
      </header>
      <div className="approval-body">
        <p className="approval-tool">
          <code>{approval.toolName}</code>
        </p>
        <p className="approval-reason">{approvalReasonText(approval)}</p>
      </div>
      <div className="approval-actions">
        <button className="primary" disabled={submitting} onClick={() => onDecide('allowed-once')}>
          允许一次
        </button>
        <button className="secondary danger" disabled={submitting} onClick={() => onDecide('rejected')}>
          拒绝
        </button>
      </div>
    </section>
  )
}
