import type { ApprovalDecision, ApprovalPrompt, ApprovalRequest } from '../security/approval.ts'

export type ApprovalRequestResult =
  | { status: 'decision'; decision: ApprovalDecision }
  | { status: 'unavailable' | 'timed-out' | 'cancelled' }

interface PendingApproval {
  request: ApprovalRequest
  windowId: number
  resolve: (result: ApprovalRequestResult) => void
  timer: ReturnType<typeof setTimeout>
}

interface ApprovalCoordinatorCallbacks {
  deliver: (request: ApprovalRequest) => boolean
  notify: (request: ApprovalRequest, windowId: number) => void
  clearNotification: (id: string) => void
  resolved: (id: string) => void
}

/** Time allowed for a user to reopen the panel and decide. */
export const APPROVAL_TIMEOUT_MS = 60_000

/** Own pending approvals independently of the side panel's lifetime. */
export class ApprovalCoordinator {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(
    private readonly callbacks: ApprovalCoordinatorCallbacks,
    private readonly timeoutMs = APPROVAL_TIMEOUT_MS,
  ) {}

  request(
    prompt: ApprovalPrompt,
    signal: AbortSignal,
    windowId: number,
    sessionId?: string,
  ): Promise<ApprovalRequestResult> {
    if (signal.aborted) return Promise.resolve({ status: 'cancelled' })
    const request: ApprovalRequest = {
      ...prompt,
      id: crypto.randomUUID(),
      ...(sessionId === undefined ? {} : { sessionId }),
    }
    return new Promise((resolve) => {
      const onAbort = (): void => { this.settle(request.id, { status: 'cancelled' }) }
      const resolveWithCleanup = (result: ApprovalRequestResult): void => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      }
      const timer = setTimeout(() => { this.settle(request.id, { status: 'timed-out' }) }, this.timeoutMs)
      this.pending.set(request.id, { request, windowId, resolve: resolveWithCleanup, timer })
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) {
        this.settle(request.id, { status: 'cancelled' })
        return
      }
      if (!this.callbacks.deliver(request)) this.callbacks.notify(request, windowId)
    })
  }

  respond(id: string, decision: ApprovalDecision): void {
    this.settle(id, { status: 'decision', decision })
  }

  cancelAll(): void {
    for (const id of [...this.pending.keys()]) this.settle(id, { status: 'cancelled' })
  }

  /** Re-send every live request after a panel has installed its listeners. */
  replay(deliver: (request: ApprovalRequest) => boolean): void {
    for (const { request } of this.pending.values()) {
      if (deliver(request)) this.callbacks.clearNotification(request.id)
    }
  }

  /** Notify for requests that lost their final visible panel. */
  notifyPending(): void {
    for (const { request, windowId } of this.pending.values()) {
      this.callbacks.notify(request, windowId)
    }
  }

  windowId(id: string): number | undefined {
    return this.pending.get(id)?.windowId
  }

  private settle(id: string, result: ApprovalRequestResult): void {
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    pending.resolve(result)
    this.callbacks.clearNotification(id)
    this.callbacks.resolved(id)
  }
}
