/**
 * Service-worker cache of pending ask_user_question pushes.
 *
 * The sidebar may be closed when the bridge pushes `question.requested` — the
 * panel port set can even be empty. Caching the push (and evicting on
 * `question.resolved` or a panel answer) lets a newly opened panel replay the
 * still-pending questions instead of silently hanging the host turn. The
 * cache is transient by design: a bridge reconnect clears it (the plugin
 * delegates unanswered questions to the next answerer on connection loss).
 *
 * @module
 */

import type { ServerFrame } from 'dsh-browser-firefox/src/protocol.ts'

type QuestionRequested = Extract<ServerFrame, { t: 'question.requested' }>
type QuestionFrame = QuestionRequested | Extract<ServerFrame, { t: 'question.resolved' }>

function questionKey(sessionId: string, questionId: string): string {
  return `${sessionId}${questionId}`
}

export class TransientQuestionCache {
  private readonly questions = new Map<string, QuestionRequested>()

  /** Track one question push frame (requested caches, resolved evicts). */
  ingest(frame: ServerFrame): void {
    if (frame.t === 'question.requested') {
      this.questions.set(questionKey(frame.sessionId, frame.id), frame)
      return
    }
    if (frame.t === 'question.resolved') {
      this.questions.delete(questionKey(frame.sessionId, frame.id))
    }
  }

  /** Evict a question the panel just answered (accepted or declined). */
  settle(sessionId: string, questionId: string): void {
    this.questions.delete(questionKey(sessionId, questionId))
  }

  /** Still-pending question pushes, for replay to a (re)opened panel. */
  replay(): QuestionFrame[] {
    return [...this.questions.values()]
  }

  clear(): void {
    this.questions.clear()
  }
}
