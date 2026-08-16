// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { RecentSessionTracker, sessionIdFromFrame } from '../src/background/session-continuity.ts'

describe('RecentSessionTracker', () => {
  it('restores and persists the latest browser session', async () => {
    const write = vi.fn(async () => {})
    const tracker = new RecentSessionTracker({ read: async () => 'session-restored', write })
    await tracker.ready
    expect(tracker.current()).toBe('session-restored')

    expect(tracker.remember('session-current')).toBe(true)
    expect(tracker.remember('session-current')).toBe(false)
    await vi.waitFor(() => { expect(write).toHaveBeenCalledWith('session-current') })
  })

  it('does not let a late storage read overwrite a live update', async () => {
    let finishRead!: (value: unknown) => void
    const tracker = new RecentSessionTracker({
      read: async () => await new Promise((resolve) => { finishRead = resolve }),
      write: async () => {},
    })
    tracker.remember('session-live')
    finishRead('session-stale')
    await tracker.ready
    expect(tracker.current()).toBe('session-live')
  })
})

describe('sessionIdFromFrame', () => {
  it('reads live session events without treating subscription metadata as activity', () => {
    expect(sessionIdFromFrame({
      t: 'event',
      frame: { rpcId: '1', method: 'session/event', payload: { sessionId: 'session-1', event: { type: 'turn/start' } } },
    })).toBe('session-1')
    expect(sessionIdFromFrame({
      t: 'event',
      frame: { rpcId: '2', method: 'session/subscribed', payload: { sessionId: 'session-2' } },
    })).toBeUndefined()
  })
})
