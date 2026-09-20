import type { PendingQuestion, ResolvedQuestion } from './events.ts'

/** Append a new host ask without losing earlier asks; a replay updates in place. */
export function upsertPendingQuestion(
  questions: PendingQuestion[],
  next: PendingQuestion,
): PendingQuestion[] {
  const index = questions.findIndex((candidate) => sameQuestion(candidate, next))
  if (index === -1) return [...questions, next]
  const updated = questions.slice()
  updated[index] = next
  return updated
}

/** Remove only the host ask named by both session and question id. */
export function removePendingQuestion<T extends ResolvedQuestion>(
  questions: T[],
  resolved: ResolvedQuestion,
): T[] {
  return questions.filter((candidate) => !sameQuestion(candidate, resolved))
}

export function hasPendingQuestion(
  questions: ResolvedQuestion[],
  target: ResolvedQuestion,
): boolean {
  return questions.some((candidate) => sameQuestion(candidate, target))
}

/**
 * Interpret the `bridge/questionAnswer` rpc receipt: true when the bridge
 * accepted the answer; `'not-pending'` when the question is already gone
 * (answered elsewhere, aborted); `'bad-answer'` when the payload was refused.
 */
export function questionReceiptReason(value: unknown): 'accepted' | 'not-pending' | 'bad-answer' | 'retry' {
  if (!isRecord(value)) return 'retry'
  if (value.accepted === true) return 'accepted'
  if (value.accepted === false && value.reason === 'not-pending') return 'not-pending'
  if (value.accepted === false && value.reason === 'bad-answer') return 'bad-answer'
  return 'retry'
}

function sameQuestion(left: ResolvedQuestion, right: ResolvedQuestion): boolean {
  return left.sessionId === right.sessionId && left.questionId === right.questionId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
