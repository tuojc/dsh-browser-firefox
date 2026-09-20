// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PendingQuestion } from '../src/panel/events.ts'
import {
  hasPendingQuestion,
  questionReceiptReason,
  removePendingQuestion,
  upsertPendingQuestion,
} from '../src/panel/pending-questions.ts'

const A: PendingQuestion = { questionId: 'q1', sessionId: 's1', questions: [{ id: 'a', question: 'A？' }] }
const B: PendingQuestion = { questionId: 'q2', sessionId: 's1', questions: [{ id: 'b', question: 'B？' }] }
const OTHER_SESSION: PendingQuestion = { questionId: 'q1', sessionId: 's2', questions: [{ id: 'a', question: 'A？' }] }

describe('upsertPendingQuestion', () => {
  it('appends new questions and updates replays in place', () => {
    let list = upsertPendingQuestion([], A)
    list = upsertPendingQuestion(list, B)
    expect(list.map((q) => q.questionId)).toEqual(['q1', 'q2'])
    const updated: PendingQuestion = { ...A, questions: [{ id: 'a', question: 'A2？' }] }
    list = upsertPendingQuestion(list, updated)
    expect(list).toHaveLength(2)
    expect(list[0]?.questions[0]?.question).toBe('A2？')
  })

  it('same question id in another session is a different question', () => {
    const list = upsertPendingQuestion(upsertPendingQuestion([], A), OTHER_SESSION)
    expect(list).toHaveLength(2)
  })
})

describe('removePendingQuestion / hasPendingQuestion', () => {
  it('removes only the exact session+id pair', () => {
    const list = [A, OTHER_SESSION, B]
    const next = removePendingQuestion(list, { questionId: 'q1', sessionId: 's1' })
    expect(next.map((q) => q.sessionId)).toEqual(['s2', 's1'])
    expect(hasPendingQuestion(list, { questionId: 'q2', sessionId: 's1' })).toBe(true)
    expect(hasPendingQuestion(list, { questionId: 'q3', sessionId: 's1' })).toBe(false)
  })
})

describe('questionReceiptReason', () => {
  it('maps the bridge receipt', () => {
    expect(questionReceiptReason({ accepted: true })).toBe('accepted')
    expect(questionReceiptReason({ accepted: false, reason: 'not-pending' })).toBe('not-pending')
    expect(questionReceiptReason({ accepted: false, reason: 'bad-answer' })).toBe('bad-answer')
    expect(questionReceiptReason({ accepted: false, reason: 'weird' })).toBe('retry')
    expect(questionReceiptReason(null)).toBe('retry')
  })
})
