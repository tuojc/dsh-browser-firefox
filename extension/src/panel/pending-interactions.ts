/**
 * 侧边栏待处理交互（问答卡片、宿主审批卡片）的列表维护与回执解释。
 *
 * @module
 */

import type { PendingInteraction, ResolvedInteraction } from './events.ts'
import { isRecord } from './json.ts'

/** Append a new pending interaction; a replay of the same one updates in place. */
export function upsertPending<T extends PendingInteraction>(list: T[], next: T): T[] {
  const index = list.findIndex((candidate) => sameInteraction(candidate, next))
  if (index === -1) return [...list, next]
  const updated = list.slice()
  updated[index] = next
  return updated
}

/** Remove only the interaction named by both session and request id. */
export function removePending<T extends InteractionIdentity>(list: T[], target: InteractionIdentity): T[] {
  return list.filter((candidate) => !sameInteraction(candidate, target))
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

/** Pending or resolved form of either interaction kind. */
type InteractionIdentity = PendingInteraction | ResolvedInteraction

function sameInteraction(left: InteractionIdentity, right: InteractionIdentity): boolean {
  return left.sessionId === right.sessionId && idOf(left) === idOf(right)
}

/** The bridge-side id of either interaction kind. */
function idOf(interaction: InteractionIdentity): string {
  return 'questionId' in interaction ? interaction.questionId : interaction.approvalId
}
