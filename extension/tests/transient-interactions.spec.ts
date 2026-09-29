// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { TransientInteractions } from '../src/background/transient-interactions.ts'

const REQUESTED = {
  t: 'question.requested' as const,
  id: 'q1',
  sessionId: 's1',
  questions: [{ id: 'a', question: 'A？' }],
}

const APPROVAL = {
  t: 'approval.requested' as const,
  id: 'p1',
  sessionId: 's1',
  toolName: 'bash',
  reason: '需要写入工作区外的文件',
}

describe('TransientInteractions', () => {
  it('caches requested frames and replays them', () => {
    const cache = new TransientInteractions()
    cache.ingest(REQUESTED)
    expect(cache.replay()).toEqual([REQUESTED])
  })

  it('evicts on question.resolved for the same session+id', () => {
    const cache = new TransientInteractions()
    cache.ingest(REQUESTED)
    cache.ingest({ t: 'question.resolved', id: 'q1', sessionId: 's2' }) // 别的会话不影响
    expect(cache.replay()).toHaveLength(1)
    cache.ingest({ t: 'question.resolved', id: 'q1', sessionId: 's1' })
    expect(cache.replay()).toHaveLength(0)
  })

  it('settleQuestion removes the answered question', () => {
    const cache = new TransientInteractions()
    cache.ingest(REQUESTED)
    cache.settleQuestion('s1', 'q1')
    expect(cache.replay()).toHaveLength(0)
  })

  it('caches approvals separately from questions', () => {
    const cache = new TransientInteractions()
    cache.ingest(REQUESTED)
    cache.ingest(APPROVAL)
    expect(cache.replay()).toHaveLength(2)
    // 同一个 id 在两个命名空间里互不影响
    cache.ingest({ t: 'approval.resolved', id: 'q1', sessionId: 's1' } as unknown as Parameters<typeof cache.ingest>[0])
    expect(cache.replay()).toHaveLength(2)
    cache.settleQuestion('s1', 'q1')
    expect(cache.replay()).toEqual([APPROVAL])
    cache.settleApproval('s1', 'p1')
    expect(cache.replay()).toHaveLength(0)
  })

  it('evicts approvals on approval.resolved', () => {
    const cache = new TransientInteractions()
    cache.ingest(APPROVAL)
    cache.ingest({ t: 'approval.resolved', id: 'p1', sessionId: 's1' })
    expect(cache.replay()).toHaveLength(0)
  })

  it('ignores unrelated frames and clears everything', () => {
    const cache = new TransientInteractions()
    cache.ingest(REQUESTED)
    cache.ingest(APPROVAL)
    cache.ingest({ t: 'ping' } as unknown as Parameters<typeof cache.ingest>[0])
    expect(cache.replay()).toHaveLength(2)
    cache.clear()
    expect(cache.replay()).toHaveLength(0)
  })
})
