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

describe('pluginVersionLabel', () => {
  it('已知版本号时直接显示，否则按连接状态解释', async () => {
    const { pluginVersionLabel } = await import('../src/panel/version-check.ts')
    expect(pluginVersionLabel('0.4.8', 'connected')).toBe('0.4.8')
    // 已连接但插件过旧（0.4.6 之前不互带 version）
    expect(pluginVersionLabel(null, 'connected')).toContain('过旧')
    expect(pluginVersionLabel('', 'connected')).toContain('过旧')
    // 未连接时直说未连接，而不是误报「插件过旧」
    expect(pluginVersionLabel(null, 'stopped')).toBe('未连接')
    expect(pluginVersionLabel(null, 'reconnecting')).toBe('未连接')
  })
})
