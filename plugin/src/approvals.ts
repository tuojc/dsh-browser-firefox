/**
 * Host approval ownership: claim the host `approval/request` waterfall for
 * extension-owned sessions, push the decision request to the connected
 * extension, and settle the waterfall with the sidebar's choice.
 *
 * Settlement paths (first wins, later ones no-op):
 *  - the sidebar decides → the waterfall resolves with that outcome;
 *  - the host aborts `request.signal` (turn cancelled, session disposed) →
 *    the extension is sent `approval.resolved` and the waterfall resolves
 *    with `'cancelled'` (the host vocabulary has no rejection channel here);
 *  - the bridge connection drops ({@link delegateAll}) → the waterfall is
 *    delegated to `next()` so another answerer (dsh web) can still decide;
 *  - plugin unload ({@link dispose}) → `'unavailable'`, the fail-closed
 *    outcome of the host's closed outcome set.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { ServerFrame } from './protocol.ts'

/** The host's closed approval outcome vocabulary. */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'

/** One approval prompt as it crosses the bridge. */
export interface ApprovalPrompt {
  toolName: string
  callId?: string
  reason?: string
}

/** Decision the sidebar sends back over `bridge/approvalDecision`. */
export type ApprovalDecision = 'allowed-once' | 'rejected'

/** Receipt answered to the extension's `bridge/approvalDecision` rpc. */
export type ApprovalReceipt =
  | { accepted: true }
  | { accepted: false; reason: 'not-pending' | 'bad-decision' }

/** Args of the plugin-local `bridge/approvalDecision` rpc method. */
export interface ApprovalDecisionArgs {
  approvalId: string
  sessionId: string
  decision?: unknown
}

type PendingOutcome =
  | { kind: 'decide'; outcome: ApprovalOutcome }
  | { kind: 'delegate' }

interface PendingApproval {
  readonly sessionId: string
  settled: boolean
  readonly complete: (outcome: PendingOutcome) => void
  readonly signal: AbortSignal | undefined
  onAbort: (() => void) | undefined
}

/** Parse the extension's `bridge/approvalDecision` rpc args (ids + closed decision). */
export function asApprovalDecisionArgs(value: unknown): ApprovalDecisionArgs | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const args = value as Record<string, unknown>
  if (typeof args.approvalId !== 'string' || typeof args.sessionId !== 'string') return undefined
  if (args.decision !== 'allowed-once' && args.decision !== 'rejected') return undefined
  return { approvalId: args.approvalId, sessionId: args.sessionId, decision: args.decision }
}

/** Owns the host approval waterfall for extension-driven sessions. */
export class ApprovalBridge {
  private readonly pending = new Map<string, PendingApproval>()

  constructor(private readonly deps: {
    /** Push one server frame to the connected extension (must tolerate a dead socket). */
    push: (frame: ServerFrame) => void
  }) {}

  /**
   * Own one host waterfall request: push `approval.requested` to the
   * extension and suspend until one of the settlement paths wins.
   *
   * @param routingSessionId - extension-visible session id (the owned session the card is filed under).
   * @param prompt - tool name, optional call id and human-readable reason.
   * @param next - waterfall delegation, used when the bridge connection drops.
   * @param signal - host cancellation lifetime for this request.
   * @returns the host approval outcome.
   */
  ask(
    routingSessionId: string,
    prompt: ApprovalPrompt,
    next: () => Promise<ApprovalOutcome>,
    signal?: AbortSignal,
  ): Promise<ApprovalOutcome> {
    if (signal?.aborted) return Promise.resolve<ApprovalOutcome>('cancelled')
    const approvalId = randomUUID()
    return new Promise<ApprovalOutcome>((resolve, reject) => {
      const entry: PendingApproval = {
        sessionId: routingSessionId,
        settled: false,
        signal,
        complete: (outcome) => {
          if (entry.settled) return
          entry.settled = true
          this.pending.delete(approvalId)
          if (entry.onAbort !== undefined) entry.signal?.removeEventListener('abort', entry.onAbort)
          if (outcome.kind === 'decide') resolve(outcome.outcome)
          else next().then(resolve, reject)
        },
        onAbort: undefined,
      }
      if (signal !== undefined) {
        entry.onAbort = () => {
          // Withdraw the card before settling so a late click can never be
          // reported as accepted for a dead request.
          this.deps.push({ t: 'approval.resolved', id: approvalId, sessionId: routingSessionId })
          entry.complete({ kind: 'decide', outcome: 'cancelled' })
        }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.pending.set(approvalId, entry)
      this.deps.push({
        t: 'approval.requested',
        id: approvalId,
        sessionId: routingSessionId,
        toolName: prompt.toolName,
        ...(prompt.callId === undefined ? {} : { callId: prompt.callId }),
        ...(prompt.reason === undefined ? {} : { reason: prompt.reason }),
      })
    })
  }

  /**
   * Settle one pending approval from the extension's `bridge/approvalDecision`
   * rpc. The server replies with this receipt.
   */
  decide(args: ApprovalDecisionArgs): ApprovalReceipt {
    const entry = this.pending.get(args.approvalId)
    if (entry === undefined || entry.settled || entry.sessionId !== args.sessionId) {
      return { accepted: false, reason: 'not-pending' }
    }
    if (args.decision !== 'allowed-once' && args.decision !== 'rejected') {
      return { accepted: false, reason: 'bad-decision' }
    }
    entry.complete({ kind: 'decide', outcome: args.decision })
    return { accepted: true }
  }

  /** Bridge connection replaced/closed: delegate every unsettled approval. */
  delegateAll(): void {
    for (const entry of [...this.pending.values()]) {
      if (!entry.settled) entry.complete({ kind: 'delegate' })
    }
  }

  /** Plugin unload: answer everything fail-closed so no tool call outlives the plugin. */
  dispose(): void {
    for (const entry of [...this.pending.values()]) {
      if (!entry.settled) entry.complete({ kind: 'decide', outcome: 'unavailable' })
    }
  }
}
