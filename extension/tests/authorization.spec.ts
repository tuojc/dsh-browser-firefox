// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { authorizeByLevel, classifyTool } from '../src/background/authorization.ts'

describe('classifyTool', () => {
  it('classifies snapshot/get_text/list_tabs/screenshot as reads', () => {
    expect(classifyTool('browser_snapshot', {})).toBe('read')
    expect(classifyTool('browser_get_text', {})).toBe('read')
    expect(classifyTool('browser_list_tabs', {})).toBe('read')
    expect(classifyTool('browser_screenshot', {})).toBe('read')
  })

  it('splits browser_evaluate by sub-action', () => {
    expect(classifyTool('browser_evaluate', { action: 'count', selector: 'p' })).toBe('read')
    expect(classifyTool('browser_evaluate', { action: 'getText', selector: 'p' })).toBe('read')
    expect(classifyTool('browser_evaluate', { action: 'querySelectorAll', selector: 'p' })).toBe('read')
    expect(classifyTool('browser_evaluate', { action: 'click', selector: 'p' })).toBe('action')
    expect(classifyTool('browser_evaluate', { action: 'setValue', selector: 'p' })).toBe('action')
    expect(classifyTool('browser_evaluate', { action: 'bogus', selector: 'p' })).toBe('action')
  })

  it('classifies everything else as an action', () => {
    expect(classifyTool('browser_click', {})).toBe('action')
    expect(classifyTool('browser_type', {})).toBe('action')
    expect(classifyTool('browser_navigate', {})).toBe('action')
    expect(classifyTool('browser_scroll', {})).toBe('action')
  })
})

describe('authorizeByLevel', () => {
  it('locked denies both kinds', () => {
    expect(authorizeByLevel('locked', 'read').type).toBe('deny')
    expect(authorizeByLevel('locked', 'action').type).toBe('deny')
  })

  it('read allows reads and denies actions', () => {
    expect(authorizeByLevel('read', 'read')).toEqual({ type: 'allow' })
    const denied = authorizeByLevel('read', 'action')
    expect(denied.type).toBe('deny')
    if (denied.type === 'deny') expect(denied.reason).toContain('只读')
  })

  it('readwrite allows both kinds', () => {
    expect(authorizeByLevel('readwrite', 'read')).toEqual({ type: 'allow' })
    expect(authorizeByLevel('readwrite', 'action')).toEqual({ type: 'allow' })
  })
})
