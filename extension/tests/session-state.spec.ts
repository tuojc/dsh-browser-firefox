// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { TabSessionManager, pushTab } from '../src/background/session-state.ts'

describe('TabSessionManager', () => {
  it('creates fresh state per session and switches without wiping others', () => {
    const m = new TabSessionManager()
    const a = m.ensure('A')
    a.workingTabId = 11
    a.groupId = 100
    pushTab(a.tabStack, 11)
    pushTab(a.tabStack, 12)

    const b = m.ensure('B')
    expect(b.workingTabId).toBeUndefined()
    expect(b.groupId).toBeUndefined()
    expect(b.tabStack).toEqual([])

    // 切回 A：工作 tab / group / 栈全部恢复（B2 修复的核心行为）。
    const a2 = m.ensure('A')
    expect(a2.workingTabId).toBe(11)
    expect(a2.groupId).toBe(100)
    expect(a2.tabStack).toEqual([11, 12])
  })

  it('keeps an anonymous session for calls without a sessionId', () => {
    const m = new TabSessionManager()
    const anon = m.ensure(undefined)
    anon.workingTabId = 5
    m.ensure('A')
    expect(m.ensure(undefined).workingTabId).toBe(5)
    expect(m.current().workingTabId).toBe(5)
  })

  it('removeTab forgets the tab in every session', () => {
    const m = new TabSessionManager()
    const a = m.ensure('A')
    a.workingTabId = 11
    pushTab(a.tabStack, 10)
    pushTab(a.tabStack, 11)
    const b = m.ensure('B')
    b.workingTabId = 11 // 同一 tab 被两个 session 引用的情况也要清
    pushTab(b.tabStack, 11)

    m.removeTab(11)
    expect(m.ensure('A').workingTabId).toBeUndefined()
    expect(m.ensure('A').tabStack).toEqual([10])
    expect(m.ensure('B').workingTabId).toBeUndefined()
    expect(m.ensure('B').tabStack).toEqual([])
  })

  it('clearGroup drops only the group mapping (A2: dead group retry)', () => {
    const m = new TabSessionManager()
    const a = m.ensure('A')
    a.groupId = 100
    a.workingTabId = 11
    m.clearGroup('A')
    expect(m.groupOf('A')).toBeUndefined()
    expect(a.groupId).toBeUndefined()
    expect(a.workingTabId).toBe(11)
    expect(m.groupOf('B')).toBeUndefined()
  })
})

describe('pushTab', () => {
  it('dedupes and keeps most recent last', () => {
    const stack: number[] = []
    pushTab(stack, 1)
    pushTab(stack, 2)
    pushTab(stack, 1)
    expect(stack).toEqual([2, 1])
  })
})
