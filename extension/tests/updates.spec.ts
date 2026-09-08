// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAmoUpdate, compareVersions } from '../src/background/updates.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('compareVersions', () => {
  it('compares numeric segments', () => {
    expect(compareVersions('0.4.1', '0.4.0')).toBeGreaterThan(0)
    expect(compareVersions('0.4.0', '0.4.1')).toBeLessThan(0)
    expect(compareVersions('0.4.1', '0.4.1')).toBe(0)
    expect(compareVersions('1.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
  })

  it('ignores prerelease suffixes', () => {
    expect(compareVersions('0.5.0-beta.1', '0.4.9')).toBeGreaterThan(0)
  })
})

describe('checkAmoUpdate', () => {
  it('returns info when AMO has a newer version', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ current_version: { version: '0.5.0' } }),
    })))
    await expect(checkAmoUpdate('0.4.1')).resolves.toMatchObject({ version: '0.5.0' })
  })

  it('stays silent when up to date, unlisted, or offline', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ current_version: { version: '0.4.1' } }),
    })))
    await expect(checkAmoUpdate('0.4.1')).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })))
    await expect(checkAmoUpdate('0.4.1')).resolves.toBeUndefined()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    await expect(checkAmoUpdate('0.4.1')).resolves.toBeUndefined()
  })
})
