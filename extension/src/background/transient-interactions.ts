/**
 * Service-worker cache of pending host-interaction pushes (ask_user_question
 * cards and host approval cards).
 *
 * The sidebar may be closed when the bridge pushes `question.requested` /
 * `approval.requested` — the panel port set can even be empty. Caching the
 * push (and evicting on the matching `*.resolved` or a panel answer) lets a
 * newly opened panel replay the still-pending cards instead of silently
 * hanging the host turn. The cache is transient by design: a bridge reconnect
 * clears it (the plugin delegates unanswered interactions to the next
 * answerer on connection loss).
 *
 * @module
 */

import type { ServerFrame } from 'dsh-browser-firefox/src/protocol.ts'

type QuestionRequested = Extract<ServerFrame, { t: 'question.requested' }>
type QuestionResolved = Extract<ServerFrame, { t: 'question.resolved' }>
type ApprovalRequested = Extract<ServerFrame, { t: 'approval.requested' }>
type ApprovalResolved = Extract<ServerFrame, { t: 'approval.resolved' }>
type QuestionFrame = QuestionRequested | QuestionResolved
type ApprovalFrame = ApprovalRequested | ApprovalResolved

function interactionKey(sessionId: string, id: string): string {
  return `${sessionId}${id}`
}

export class TransientInteractions {
  private readonly questions = new Map<string, QuestionRequested>()
  private readonly approvals = new Map<string, ApprovalRequested>()

  /** Track one push frame (requested caches, resolved evicts). */
  ingest(frame: QuestionFrame | ApprovalFrame): void {
    if (frame.t === 'question.requested') {
      this.questions.set(interactionKey(frame.sessionId, frame.id), frame)
      return
    }
    if (frame.t === 'question.resolved') {
      this.questions.delete(interactionKey(frame.sessionId, frame.id))
      return
    }
    if (frame.t === 'approval.requested') {
      this.approvals.set(interactionKey(frame.sessionId, frame.id), frame)
      return
    }
    this.approvals.delete(interactionKey(frame.sessionId, frame.id))
  }

  /** Evict a question the panel just answered (accepted or declined). */
  settleQuestion(sessionId: string, questionId: string): void {
    this.questions.delete(interactionKey(sessionId, questionId))
  }

  /** Evict an approval the panel just decided. */
  settleApproval(sessionId: string, approvalId: string): void {
    this.approvals.delete(interactionKey(sessionId, approvalId))
  }

  /** Still-pending interaction pushes, for replay to a (re)opened panel. */
  replay(): ServerFrame[] {
    return [...this.questions.values(), ...this.approvals.values()]
  }

  clear(): void {
    this.questions.clear()
    this.approvals.clear()
  }
}
