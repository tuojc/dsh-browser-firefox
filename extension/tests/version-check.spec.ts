// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { versionMismatch } from '../src/panel/version-check.ts'

describe('versionMismatch', () => {
  it('flags only when both versions are known and different', () => {
    expect(versionMismatch('0.4.6', '0.4.6')).toBe(false)
    expect(versionMismatch('0.4.6', '0.4.5')).toBe(true)
    // 旧插件不带版本号：无法判断，不提示
    expect(versionMismatch('0.4.6', null)).toBe(false)
    expect(versionMismatch('0.4.6', undefined)).toBe(false)
    expect(versionMismatch('0.4.6', '')).toBe(false)
  })
})
