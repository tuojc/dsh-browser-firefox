// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { registerToolbarAction } from '../src/background/toolbar.ts'

describe('registerToolbarAction', () => {
  it('点击顶部图标时调用 sidebar.toggle()', () => {
    let listener: (() => void) | undefined
    const action = { onClicked: { addListener: (cb: () => void) => { listener = cb } } }
    const sidebar = { toggle: vi.fn(async () => {}) }
    registerToolbarAction(action, sidebar)
    expect(listener).toBeDefined()
    listener?.()
    expect(sidebar.toggle).toHaveBeenCalledTimes(1)
  })

  it('sidebar.toggle() 拒绝时被吞掉，不产生未处理拒绝', async () => {
    let listener: (() => void) | undefined
    const action = { onClicked: { addListener: (cb: () => void) => { listener = cb } } }
    const sidebar = { toggle: vi.fn(async () => { throw new Error('cannot open sidebar') }) }
    registerToolbarAction(action, sidebar)
    listener?.()
    await Promise.resolve()
    expect(sidebar.toggle).toHaveBeenCalledTimes(1)
  })
})
