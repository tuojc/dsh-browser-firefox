// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PendingQuestion } from '../src/panel/events.ts'
import {
  hasPendingQuestion,
  questionReceiptDisposition,
  removePendingQuestion,
  upsertPendingQuestion,
} from '../src/panel/pending-questions.ts'

function pending(rpcId: string, question: string, sessionId = 'session'): PendingQuestion {
  return { rpcId, sessionId, questions: [{ id: rpcId, question }] }
}

describe('pending question queue', () => {
  it('preserves concurrent asks and removes only the matching resolution', () => {
    const first = pending('first', 'First?')
    const second = pending('second', 'Second?')
    const queue = upsertPendingQuestion(upsertPendingQuestion([], first), second)
    expect(queue).toEqual([first, second])
    expect(removePendingQuestion(queue, { sessionId: 'session', rpcId: 'second' })).toEqual([first])
    expect(hasPendingQuestion(queue, { sessionId: 'other-session', rpcId: 'first' })).toBe(false)
  })

  it('updates a replayed ask in place without duplicating or reordering it', () => {
    const first = pending('first', 'Old copy')
    const second = pending('second', 'Second?')
    const replay = pending('first', 'Fresh copy')
    expect(upsertPendingQuestion([first, second], replay)).toEqual([replay, second])
  })
})

describe('question response receipts', () => {
  it('clears only accepted and known not-pending questions', () => {
    expect(questionReceiptDisposition({ accepted: true })).toBe('accepted')
    expect(questionReceiptDisposition({ accepted: false, reason: 'not-pending' })).toBe('not-pending')
    expect(questionReceiptDisposition({ accepted: false, reason: 'bad-response' })).toBe('retry')
    expect(questionReceiptDisposition({ accepted: false, reason: 'future-reason' })).toBe('retry')
    expect(questionReceiptDisposition('malformed')).toBe('retry')
  })
})
