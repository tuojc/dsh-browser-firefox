// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import {
  resumableSessions,
  sessionAcceptsPrompts,
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

describe('sessionAcceptsPrompts', () => {
  it('requires a connected, settled session with a concrete ID', () => {
    expect(sessionAcceptsPrompts(true, false, 'session')).toBe(true)
    expect(sessionAcceptsPrompts(false, false, 'session')).toBe(false)
    expect(sessionAcceptsPrompts(true, true, 'old-session')).toBe(false)
    expect(sessionAcceptsPrompts(true, false, null)).toBe(false)
  })
})
