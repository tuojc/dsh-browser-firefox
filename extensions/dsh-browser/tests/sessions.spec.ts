// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  resumableSessions,
  sessionAcceptsPrompts,
  SessionRuntimeCache,
  type SessionPickerEntry,
} from '../src/panel/sessions.ts'

const ordinary: SessionPickerEntry = {
  sessionId: 'ordinary',
  updatedAt: 3,
  running: false,
  blank: false,
  cwd: '/workspace',
}

describe('resumableSessions', () => {
  it('keeps ordinary started sessions in host recency order', () => {
    const second = { ...ordinary, sessionId: 'second', updatedAt: 2 }
    expect(resumableSessions([ordinary, second])).toEqual([ordinary, second])
  })

  it('removes blank and subagent sessions that cannot be resumed normally', () => {
    expect(resumableSessions([
      { ...ordinary, sessionId: 'blank', blank: true },
      { ...ordinary, sessionId: 'subagent', origin: 'subagent' },
      ordinary,
    ])).toEqual([ordinary])
  })
})

describe('SessionRuntimeCache', () => {
  it('restores off-session running and concurrent question state', () => {
    const cache = new SessionRuntimeCache()
    cache.startTurn('session')
    cache.rememberQuestion({ rpcId: 'q1', sessionId: 'session', questions: [{ id: '1', question: 'First?' }] })
    cache.rememberQuestion({ rpcId: 'q2', sessionId: 'session', questions: [{ id: '2', question: 'Second?' }] })
    expect(cache.snapshot('session')).toMatchObject({ running: true })
    expect(cache.snapshot('session').questions.map((question) => question.rpcId)).toEqual(['q1', 'q2'])
  })

  it('lets live status beat an older list baseline', () => {
    const cache = new SessionRuntimeCache()
    cache.finishTurn('session')
    cache.seedRunning('session', true)
    expect(cache.snapshot('session').running).toBe(false)
  })

  it('resolves one question and clears transient state at turn end', () => {
    const cache = new SessionRuntimeCache()
    cache.rememberQuestion({ rpcId: 'q1', sessionId: 'session', questions: [{ id: '1', question: 'First?' }] })
    cache.rememberQuestion({ rpcId: 'q2', sessionId: 'session', questions: [{ id: '2', question: 'Second?' }] })
    cache.resolveQuestion({ rpcId: 'q2', sessionId: 'session' })
    expect(cache.snapshot('session').questions.map((question) => question.rpcId)).toEqual(['q1'])
    cache.finishTurn('session')
    expect(cache.snapshot('session')).toEqual({ running: false, questions: [] })
  })
})

describe('sessionAcceptsPrompts', () => {
  it('requires a connected, settled session with a concrete ID', () => {
    expect(sessionAcceptsPrompts(true, false, 'session')).toBe(true)
    expect(sessionAcceptsPrompts(false, false, 'session')).toBe(false)
    expect(sessionAcceptsPrompts(true, true, 'old-session')).toBe(false)
    expect(sessionAcceptsPrompts(true, false, null)).toBe(false)
  })
})
