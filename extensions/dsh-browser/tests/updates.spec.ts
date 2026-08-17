// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  checkForExtensionUpdate,
  compareExtensionVersions,
  UPDATE_MANIFEST_URL,
} from '../src/panel/updates.ts'

describe('extension update checks', () => {
  it('compares Chrome numeric versions component by component', () => {
    expect(compareExtensionVersions('0.2.0', '0.2')).toBe(0)
    expect(compareExtensionVersions('0.2.9', '0.10.0')).toBeLessThan(0)
    expect(compareExtensionVersions('1.0.0.1', '1.0.0')).toBeGreaterThan(0)
    expect(() => compareExtensionVersions('1.0.0-beta', '1.0.0')).toThrow('invalid extension version')
  })

  it('reports a newer main-branch manifest', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ version: '0.3.0' }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))

    await expect(checkForExtensionUpdate('0.2.0', request)).resolves.toEqual({
      currentVersion: '0.2.0',
      latestVersion: '0.3.0',
      updateAvailable: true,
    })
    expect(request).toHaveBeenCalledWith(UPDATE_MANIFEST_URL, { cache: 'no-store' })
  })

  it('treats equal or older remote versions as current', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ version: '0.2.0' }),
      { status: 200 },
    ))
    await expect(checkForExtensionUpdate('0.2.0', request)).resolves.toMatchObject({
      updateAvailable: false,
    })
  })

  it('rejects unavailable and malformed manifests', async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(checkForExtensionUpdate('0.2.0', unavailable)).rejects.toThrow('(503)')

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ version: 'next' }),
      { status: 200 },
    ))
    await expect(checkForExtensionUpdate('0.2.0', malformed)).rejects.toThrow('invalid extension version')
  })

  it('keeps package, Chrome manifest, and update CSP metadata aligned', () => {
    const extensionRoot = process.cwd()
    const packageManifest = JSON.parse(readFileSync(`${extensionRoot}/package.json`, 'utf8')) as { version: string }
    const chromeManifest = JSON.parse(readFileSync(`${extensionRoot}/manifest.json`, 'utf8')) as {
      version: string
      content_security_policy: { extension_pages: string }
    }

    expect(packageManifest.version).toBe(chromeManifest.version)
    expect(chromeManifest.content_security_policy.extension_pages).toContain(new URL(UPDATE_MANIFEST_URL).origin)
  })
})
