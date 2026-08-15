import type { PendingQuestion, ResolvedQuestion } from './events.ts'

export type QuestionReceiptDisposition = 'accepted' | 'not-pending' | 'retry'

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

/** Remove only the host ask named by both session and question RPC id. */
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

/** Interpret /api/respond receipts without discarding a host-pending bad response. */
export function questionReceiptDisposition(value: unknown): QuestionReceiptDisposition {
  if (!isRecord(value)) return 'retry'
  if (value.accepted === true) return 'accepted'
  if (value.accepted === false && value.reason === 'not-pending') return 'not-pending'
  return 'retry'
}

function sameQuestion(left: ResolvedQuestion, right: ResolvedQuestion): boolean {
  return left.sessionId === right.sessionId && left.rpcId === right.rpcId
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
