// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { isAtBottom } from '../src/panel/scroll.ts'

describe('isAtBottom', () => {
  it('贴底（余量小于阈值）判定为 true', () => {
    expect(isAtBottom(900, 1000, 100, 60)).toBe(true)
    expect(isAtBottom(950, 1000, 100, 60)).toBe(true)
  })

  it('远离底部判定为 false', () => {
    expect(isAtBottom(0, 1000, 100, 60)).toBe(false)
    expect(isAtBottom(800, 1000, 100, 60)).toBe(false)
  })

  it('默认阈值（8px）判定贴底更精确', () => {
    expect(isAtBottom(900, 1000, 100)).toBe(true)   // 正贴底
    expect(isAtBottom(895, 1000, 100)).toBe(true)   // 上翻 5px 仍在阈值内
    expect(isAtBottom(890, 1000, 100)).toBe(false)  // 上翻 10px 视为手动打断
  })
})
