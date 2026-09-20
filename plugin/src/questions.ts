/**
 * ask_user_question ownership: claim the host `user-questions/request`
 * waterfall for extension-owned sessions, push the question to the connected
 * extension, and settle the waterfall with the sidebar's answer.
 *
 * Settlement races (first wins, later ones see `settled` and no-op):
 *  - the extension answers ({@link answer}) → waterfall resolves;
 *  - the extension declines → waterfall rejects (the tool call fails, the
 *    model is told the user refused);
 *  - the host aborts `request.signal` (turn cancelled, session disposed) →
 *    the extension is sent `question.resolved` and the waterfall rejects;
 *  - the bridge connection drops ({@link delegateAll}) → the waterfall is
 *    delegated to `next()` so another answerer (dsh web) can still serve it;
 *  - plugin unload ({@link dispose}) → everything rejects promptly.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { QuestionItem, ServerFrame } from './protocol.ts'

/** One answer item, mirroring the host AskUserQuestionAnswerItem wire form. */
export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

/** The extension's answer payload, mirroring the host AskUserQuestionAnswer. */
export interface QuestionAnswerPayload {
  answers: QuestionAnswerItem[]
}

/** Receipt answered to the extension's `bridge/questionAnswer` rpc. */
export type QuestionAnswerReceipt =
  | { accepted: true }
  | { accepted: false; reason: 'not-pending' | 'bad-answer' }

/** Args of the plugin-local `bridge/questionAnswer` rpc method. */
export interface QuestionAnswerArgs {
  questionId: string
  sessionId: string
  answer?: unknown
  decline?: boolean
}

type PendingOutcome =
  | { kind: 'answer'; answer: QuestionAnswerPayload }
  | { kind: 'reject'; error: Error }
  | { kind: 'delegate' }

interface PendingQuestion {
  readonly sessionId: string
  readonly questionIds: ReadonlySet<string>
  settled: boolean
  readonly complete: (outcome: PendingOutcome) => void
  readonly signal: AbortSignal | undefined
  onAbort: (() => void) | undefined
}

/** Error matching the host's ASK_ABORTED semantics (the service remaps it). */
function abortedError(): Error {
  return new Error('ask_user_question was aborted before the user answered')
}

function declinedError(): Error {
  return new Error('ask_user_question was declined by the user in the browser sidebar')
}

/** Structural validation of the extension's answer payload. */
export function asAnswerPayload(value: unknown, questionIds: ReadonlySet<string>): QuestionAnswerPayload | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const answers = (value as { answers?: unknown }).answers
  if (!Array.isArray(answers)) return undefined
  const items: QuestionAnswerItem[] = []
  for (const entry of answers) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || !questionIds.has(item.id)) return undefined
    if (!Array.isArray(item.selected) || item.selected.some(option => typeof option !== 'string')) return undefined
    if (item.custom !== undefined && typeof item.custom !== 'string') return undefined
    items.push({
      id: item.id,
      selected: item.selected as string[],
      ...(typeof item.custom === 'string' ? { custom: item.custom } : {}),
    })
  }
  return { answers: items }
}

/** Parse the extension's `bridge/questionAnswer` rpc args (light: ids only). */
export function asQuestionAnswerArgs(value: unknown): QuestionAnswerArgs | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const args = value as Record<string, unknown>
  return typeof args.questionId === 'string' && typeof args.sessionId === 'string'
    ? value as QuestionAnswerArgs
    : undefined
}

/** Owns the user-questions waterfall for extension-driven sessions. */
export class QuestionBridge {
  private readonly pending = new Map<string, PendingQuestion>()

  constructor(private readonly deps: {
    /** Push one server frame to the connected extension (must tolerate a dead socket). */
    push: (frame: ServerFrame) => void
  }) {}

  /**
   * Own one host waterfall request: push `question.requested` to the
   * extension and suspend until one of the settlement races wins.
   *
   * @param sessionId - asking session (already ownership-checked by the caller).
   * @param questions - host question items (forwarded verbatim).
   * @param next - waterfall delegation, used when the bridge connection drops.
   * @param signal - host cancellation lifetime for this request.
   * @returns the user's answer.
   */
  ask(
    sessionId: string,
    questions: QuestionItem[],
    next: () => Promise<QuestionAnswerPayload>,
    signal?: AbortSignal,
  ): Promise<QuestionAnswerPayload> {
    if (signal?.aborted) return Promise.reject(abortedError())
    const questionId = randomUUID()
    return new Promise<QuestionAnswerPayload>((resolve, reject) => {
      const entry: PendingQuestion = {
        sessionId,
        questionIds: new Set(questions.map(question => question.id)),
        settled: false,
        signal,
        complete: (outcome) => {
          if (entry.settled) return
          entry.settled = true
          this.pending.delete(questionId)
          if (entry.onAbort !== undefined) entry.signal?.removeEventListener('abort', entry.onAbort)
          if (outcome.kind === 'answer') resolve(outcome.answer)
          else if (outcome.kind === 'reject') reject(outcome.error)
          else next().then(resolve, reject)
        },
        onAbort: undefined,
      }
      if (signal !== undefined) {
        entry.onAbort = () => {
          // Tell the extension to drop the card before settling so a late
          // answer can never report acceptance for a dead request.
          this.deps.push({ t: 'question.resolved', id: questionId, sessionId })
          entry.complete({ kind: 'reject', error: abortedError() })
        }
        signal.addEventListener('abort', entry.onAbort, { once: true })
      }
      this.pending.set(questionId, entry)
      this.deps.push({ t: 'question.requested', id: questionId, sessionId, questions })
    })
  }

  /**
   * Settle one pending question from the extension's `bridge/questionAnswer`
   * rpc. The server replies with this receipt.
   */
  answer(args: QuestionAnswerArgs): QuestionAnswerReceipt {
    const entry = this.pending.get(args.questionId)
    if (entry === undefined || entry.settled || entry.sessionId !== args.sessionId) {
      return { accepted: false, reason: 'not-pending' }
    }
    if (args.decline === true) {
      entry.complete({ kind: 'reject', error: declinedError() })
      return { accepted: true }
    }
    const answer = asAnswerPayload(args.answer, entry.questionIds)
    if (answer === undefined) return { accepted: false, reason: 'bad-answer' }
    entry.complete({ kind: 'answer', answer })
    return { accepted: true }
  }

  /** Bridge connection replaced/closed: delegate every unsettled question. */
  delegateAll(): void {
    for (const entry of [...this.pending.values()]) {
      if (!entry.settled) entry.complete({ kind: 'delegate' })
    }
  }

  /** Plugin unload: reject everything so no tool call outlives the plugin. */
  dispose(): void {
    for (const entry of [...this.pending.values()]) {
      if (!entry.settled) {
        entry.complete({ kind: 'reject', error: new Error('browser bridge plugin was unloaded') })
      }
    }
  }
}
