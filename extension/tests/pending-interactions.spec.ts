// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PendingApproval, PendingQuestion } from '../src/panel/events.ts'
import {
  questionReceiptReason,
  removePending,
  upsertPending,
} from '../src/panel/pending-interactions.ts'

const A: PendingQuestion = { questionId: 'q1', sessionId: 's1', questions: [{ id: 'a', question: 'A？' }] }
const B: PendingQuestion = { questionId: 'q2', sessionId: 's1', questions: [{ id: 'b', question: 'B？' }] }
const OTHER_SESSION: PendingQuestion = { questionId: 'q1', sessionId: 's2', questions: [{ id: 'a', question: 'A？' }] }

describe('upsertPending（问答）', () => {
  it('appends new questions and updates replays in place', () => {
    let list = upsertPending([], A)
    list = upsertPending(list, B)
    expect(list.map((q) => q.questionId)).toEqual(['q1', 'q2'])
    const updated: PendingQuestion = { ...A, questions: [{ id: 'a', question: 'A2？' }] }
    list = upsertPending(list, updated)
    expect(list).toHaveLength(2)
    expect(list[0]?.questions[0]?.question).toBe('A2？')
  })

  it('same question id in another session is a different question', () => {
    const list = upsertPending(upsertPending([], A), OTHER_SESSION)
    expect(list).toHaveLength(2)
  })
})

describe('removePending', () => {
  it('removes only the exact session+id pair', () => {
    const list = [A, OTHER_SESSION, B]
    const next = removePending(list, { questionId: 'q1', sessionId: 's1' })
    expect(next.map((q) => q.sessionId)).toEqual(['s2', 's1'])
    expect(removePending(list, { questionId: 'q2', sessionId: 's1' })).toHaveLength(2)
    expect(removePending(list, { questionId: 'q3', sessionId: 's1' })).toHaveLength(3)
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

describe('pending approvals', () => {
  const pendingApproval: PendingApproval = { approvalId: 'a1', sessionId: 's1', toolName: 'bash' }

  it('appends approvals and updates replays in place', () => {
    const first = upsertPending([], pendingApproval)
    expect(first).toEqual([pendingApproval])
    const replay = upsertPending(first, { ...pendingApproval, reason: '补充原因' })
    expect(replay).toHaveLength(1)
    expect(replay[0]?.reason).toBe('补充原因')
  })

  it('removes only the approval matching session and id', () => {
    const list = [pendingApproval, { approvalId: 'a2', sessionId: 's1', toolName: 'browser_click' }]
    expect(removePending(list, { approvalId: 'a1', sessionId: 's2' })).toHaveLength(2)
    expect(removePending(list, { approvalId: 'a1', sessionId: 's1' }))
      .toEqual([{ approvalId: 'a2', sessionId: 's1', toolName: 'browser_click' }])
  })

  it('两种交互共用同一套 upsert/remove 逻辑', () => {
    const questions = upsertPending<PendingQuestion>([], A)
    const approvals = upsertPending<PendingApproval>([], pendingApproval)
    expect(questions).toHaveLength(1)
    expect(approvals).toHaveLength(1)
    // 同名 id 但不同种类/会话互不影响
    expect(removePending(approvals, { questionId: 'q1', sessionId: 's1' })).toHaveLength(1)
    expect(removePending(approvals, { approvalId: 'a1', sessionId: 's1' })).toHaveLength(0)
  })
})
