// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { ServerFrame } from '@yuxianglin/dsh-bridge-browser/src/protocol.ts'
import { TransientEventCache } from '../src/background/transient-events.ts'

function event(rpcId: string, method: string, payload: unknown): ServerFrame {
  return { t: 'event', frame: { rpcId, method, payload } }
}

describe('TransientEventCache', () => {
  it('replays running turns and concurrent pending questions', () => {
    const cache = new TransientEventCache()
    const start = event('start', 'session/event', { sessionId: 'a', event: { type: 'turn/start' } })
    const first = event('q1', 'question/requested', { sessionId: 'a', questions: [{}] })
    const second = event('q2', 'question/requested', { sessionId: 'b', questions: [{}] })
    cache.ingest(start)
    cache.ingest(first)
    cache.ingest(second)
    expect(cache.replay()).toEqual([start, first, second])
  })

  it('removes only the matching resolved question', () => {
    const cache = new TransientEventCache()
    const first = event('q1', 'question/requested', { sessionId: 'a', questions: [{}] })
    const second = event('q2', 'question/requested', { sessionId: 'a', questions: [{}] })
    cache.ingest(first)
    cache.ingest(second)
    cache.ingest(event('resolved', 'question/resolved', { sessionId: 'a', questionRpcId: 'q2' }))
    expect(cache.replay()).toEqual([first])
  })

  it('drops a session turn and its questions at turn end', () => {
    const cache = new TransientEventCache()
    const other = event('other', 'question/requested', { sessionId: 'b', questions: [{}] })
    cache.ingest(event('start', 'session/event', { sessionId: 'a', event: { type: 'turn/start' } }))
    cache.ingest(event('question', 'question/requested', { sessionId: 'a', questions: [{}] }))
    cache.ingest(other)
    cache.ingest(event('end', 'session/event', { sessionId: 'a', event: { type: 'turn/end' } }))
    expect(cache.replay()).toEqual([other])
  })

  it('clears stale state across bridge generations', () => {
    const cache = new TransientEventCache()
    cache.ingest(event('q', 'question/requested', { sessionId: 'a', questions: [{}] }))
    cache.clear()
    expect(cache.replay()).toEqual([])
  })
})
