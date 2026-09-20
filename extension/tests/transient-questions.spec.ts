// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { TransientQuestionCache } from '../src/background/transient-questions.ts'

const REQUESTED = {
  t: 'question.requested' as const,
  id: 'q1',
  sessionId: 's1',
  questions: [{ id: 'a', question: 'A？' }],
}

describe('TransientQuestionCache', () => {
  it('caches requested frames and replays them', () => {
    const cache = new TransientQuestionCache()
    cache.ingest(REQUESTED)
    expect(cache.replay()).toEqual([REQUESTED])
  })

  it('evicts on question.resolved for the same session+id', () => {
    const cache = new TransientQuestionCache()
    cache.ingest(REQUESTED)
    cache.ingest({ t: 'question.resolved', id: 'q1', sessionId: 's2' }) // 别的会话不影响
    expect(cache.replay()).toHaveLength(1)
    cache.ingest({ t: 'question.resolved', id: 'q1', sessionId: 's1' })
    expect(cache.replay()).toHaveLength(0)
  })

  it('settle removes the answered question', () => {
    const cache = new TransientQuestionCache()
    cache.ingest(REQUESTED)
    cache.settle('s1', 'q1')
    expect(cache.replay()).toHaveLength(0)
  })

  it('ignores unrelated frames and clears everything', () => {
    const cache = new TransientQuestionCache()
    cache.ingest(REQUESTED)
    cache.ingest({ t: 'ping' })
    expect(cache.replay()).toHaveLength(1)
    cache.clear()
    expect(cache.replay()).toHaveLength(0)
  })
})
