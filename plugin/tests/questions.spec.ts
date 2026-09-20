import { describe, expect, it, vi } from 'vitest'
import {
  asAnswerPayload,
  asQuestionAnswerArgs,
  QuestionBridge,
  type QuestionAnswerPayload,
} from '../src/questions.ts'
import type { ServerFrame } from '../src/protocol.ts'

function makeBridge(): { bridge: QuestionBridge; frames: ServerFrame[] } {
  const frames: ServerFrame[] = []
  const bridge = new QuestionBridge({ push: (frame) => { frames.push(frame) } })
  return { bridge, frames }
}

const ITEMS = [
  { id: 'mode', question: '选哪个？', options: [{ label: 'A' }, { label: 'B' }] },
  { id: 'note', question: '备注？' },
]

describe('QuestionBridge.ask', () => {
  it('pushes question.requested and resolves with the extension answer', async () => {
    const { bridge, frames } = makeBridge()
    const next = vi.fn(async (): Promise<QuestionAnswerPayload> => ({ answers: [] }))
    const promise = bridge.ask('s1', ITEMS, next)
    expect(frames).toHaveLength(1)
    const requested = frames[0]!
    expect(requested.t).toBe('question.requested')
    if (requested.t !== 'question.requested') return
    expect(requested.sessionId).toBe('s1')
    expect(requested.questions).toEqual(ITEMS)

    const receipt = bridge.answer({
      questionId: requested.id,
      sessionId: 's1',
      answer: { answers: [{ id: 'mode', selected: ['A'] }, { id: 'note', selected: [], custom: 'hi' }] },
    })
    expect(receipt).toEqual({ accepted: true })
    await expect(promise).resolves.toEqual({
      answers: [{ id: 'mode', selected: ['A'] }, { id: 'note', selected: [], custom: 'hi' }],
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects when the extension declines', async () => {
    const { bridge, frames } = makeBridge()
    const promise = bridge.ask('s1', ITEMS, async () => ({ answers: [] }))
    const requested = frames[0]!
    if (requested.t !== 'question.requested') throw new Error('unreachable')
    const receipt = bridge.answer({ questionId: requested.id, sessionId: 's1', decline: true })
    expect(receipt).toEqual({ accepted: true })
    await expect(promise).rejects.toThrow(/declined/)
  })

  it('rejects and pushes question.resolved when the host aborts', async () => {
    const { bridge, frames } = makeBridge()
    const controller = new AbortController()
    const promise = bridge.ask('s1', ITEMS, async () => ({ answers: [] }), controller.signal)
    controller.abort()
    await expect(promise).rejects.toThrow(/aborted/)
    const resolved = frames.find((frame) => frame.t === 'question.resolved')
    expect(resolved).toBeDefined()
  })

  it('rejects immediately for an already-aborted signal', async () => {
    const { bridge, frames } = makeBridge()
    const controller = new AbortController()
    controller.abort()
    await expect(bridge.ask('s1', ITEMS, async () => ({ answers: [] }), controller.signal)).rejects.toThrow(/aborted/)
    expect(frames).toHaveLength(0)
  })

  it('delegates unsettled questions to next() when the bridge drops', async () => {
    const { bridge } = makeBridge()
    const next = vi.fn(async (): Promise<QuestionAnswerPayload> => ({ answers: [{ id: 'mode', selected: ['B'] }] }))
    const promise = bridge.ask('s1', ITEMS, next)
    bridge.delegateAll()
    await expect(promise).resolves.toEqual({ answers: [{ id: 'mode', selected: ['B'] }] })
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('late answers after settlement report not-pending', async () => {
    const { bridge, frames } = makeBridge()
    const promise = bridge.ask('s1', ITEMS, async () => ({ answers: [] }))
    const requested = frames[0]!
    if (requested.t !== 'question.requested') throw new Error('unreachable')
    bridge.delegateAll()
    await promise.catch(() => {})
    expect(bridge.answer({ questionId: requested.id, sessionId: 's1', answer: { answers: [] } }))
      .toEqual({ accepted: false, reason: 'not-pending' })
  })

  it('dispose rejects every pending question', async () => {
    const { bridge } = makeBridge()
    const promise = bridge.ask('s1', ITEMS, async () => ({ answers: [] }))
    bridge.dispose()
    await expect(promise).rejects.toThrow(/unloaded/)
  })

  it('rejects answers for a wrong session or unknown question', async () => {
    const { bridge, frames } = makeBridge()
    const promise = bridge.ask('s1', ITEMS, async () => ({ answers: [] }))
    const requested = frames[0]!
    if (requested.t !== 'question.requested') throw new Error('unreachable')
    expect(bridge.answer({ questionId: requested.id, sessionId: 'other', answer: { answers: [] } }))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(bridge.answer({ questionId: 'nope', sessionId: 's1', answer: { answers: [] } }))
      .toEqual({ accepted: false, reason: 'not-pending' })
    bridge.dispose()
    await promise.catch(() => {})
  })
})

describe('asAnswerPayload', () => {
  const ids = new Set(['mode', 'note'])

  it('accepts selected options and custom text', () => {
    expect(asAnswerPayload({ answers: [{ id: 'mode', selected: ['A'] }, { id: 'note', selected: [], custom: 'x' }] }, ids))
      .toEqual({ answers: [{ id: 'mode', selected: ['A'] }, { id: 'note', selected: [], custom: 'x' }] })
    expect(asAnswerPayload({ answers: [] }, ids)).toEqual({ answers: [] })
  })

  it('rejects ids not in the requested set and malformed items', () => {
    expect(asAnswerPayload({ answers: [{ id: 'stray', selected: [] }] }, ids)).toBeUndefined()
    expect(asAnswerPayload({ answers: [{ id: 'mode' }] }, ids)).toBeUndefined()
    expect(asAnswerPayload({ answers: [{ id: 'mode', selected: 'A' }] }, ids)).toBeUndefined()
    expect(asAnswerPayload({ answers: [{ id: 'mode', selected: [1] }] }, ids)).toBeUndefined()
    expect(asAnswerPayload({ answers: [{ id: 'mode', selected: [], custom: 7 }] }, ids)).toBeUndefined()
    expect(asAnswerPayload({}, ids)).toBeUndefined()
    expect(asAnswerPayload('nope', ids)).toBeUndefined()
  })
})

describe('asQuestionAnswerArgs', () => {
  it('requires questionId and sessionId strings', () => {
    expect(asQuestionAnswerArgs({ questionId: 'q', sessionId: 's', answer: {} }))
      .toEqual({ questionId: 'q', sessionId: 's', answer: {} })
    expect(asQuestionAnswerArgs({ questionId: 'q' })).toBeUndefined()
    expect(asQuestionAnswerArgs({ sessionId: 's' })).toBeUndefined()
    expect(asQuestionAnswerArgs(null)).toBeUndefined()
  })
})
