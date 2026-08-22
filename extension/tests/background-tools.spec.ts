// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { dispatchToolCall, type ToolAnswer, type ToolCall } from '../src/background/tools.ts'

const CALL: ToolCall = { id: 'tool-1', name: 'browser_snapshot', args: {} }
const OK: ToolAnswer = { ok: true, result: { text: 'page' } }

function mockChrome(options: {
  tab?: { id?: number; url?: string }
  responses?: Array<unknown>
  injectionError?: Error
}) {
  const responses = [...(options.responses ?? [OK])]
  const sendMessage = vi.fn(async () => {
    const response = responses.shift()
    if (response instanceof Error) throw response
    return response
  })
  const executeScript = options.injectionError === undefined
    ? vi.fn(async () => [{ frameId: 0, result: undefined }])
    : vi.fn(async () => { throw options.injectionError })
  const query = vi.fn(async () => options.tab === undefined ? [] : [options.tab])
  vi.stubGlobal('chrome', {
    tabs: { query, sendMessage },
    scripting: { executeScript },
  })
  return { executeScript, query, sendMessage }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('dispatchToolCall', () => {
  it('uses an already-loaded content script without injecting', async () => {
    const chromeMock = mockChrome({ tab: { id: 7, url: 'https://example.com' } })

    await expect(dispatchToolCall(CALL, 'ask')).resolves.toEqual(OK)
    expect(chromeMock.sendMessage).toHaveBeenCalledTimes(1)
    expect(chromeMock.executeScript).not.toHaveBeenCalled()
  })

  it('injects content.js and retries for a page opened before extension load', async () => {
    const budget = { maxItems: 80, maxChars: 16_000 }
    const chromeMock = mockChrome({
      tab: { id: 7, url: 'https://example.com/already-open' },
      responses: [new Error('Could not establish connection. Receiving end does not exist.'), { ok: true }, OK],
    })

    await expect(dispatchToolCall(CALL, 'ask', budget)).resolves.toEqual(OK)
    expect(chromeMock.executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: ['content.js'],
    })
    expect(chromeMock.sendMessage).toHaveBeenCalledTimes(3)
    expect(chromeMock.sendMessage).toHaveBeenNthCalledWith(2, 7, { type: 'DSH_BUDGET', budget })
  })

  it('does not attempt injection on Chrome internal pages', async () => {
    const chromeMock = mockChrome({
      tab: { id: 8, url: 'chrome://extensions' },
      responses: [new Error('no receiver')],
    })

    await expect(dispatchToolCall(CALL, 'ask')).resolves.toMatchObject({
      ok: false,
      error: { code: 'content-unavailable', message: expect.stringContaining('http/https') },
    })
    expect(chromeMock.executeScript).not.toHaveBeenCalled()
  })

  it('returns a clear error when recovery injection is blocked', async () => {
    mockChrome({
      tab: { id: 9, url: 'https://chromewebstore.google.com/detail/example' },
      responses: [new Error('no receiver')],
      injectionError: new Error('Cannot access contents of the page'),
    })

    await expect(dispatchToolCall(CALL, 'ask')).resolves.toMatchObject({
      ok: false,
      error: { code: 'content-unavailable', message: expect.stringContaining('受保护页面') },
    })
  })

  it('keeps the page-sharing privacy boundary ahead of tab access', async () => {
    const chromeMock = mockChrome({ tab: { id: 7, url: 'https://example.com' } })

    await expect(dispatchToolCall(CALL, 'off')).resolves.toMatchObject({
      ok: false,
      error: { code: 'action-failed' },
    })
    expect(chromeMock.query).not.toHaveBeenCalled()
  })
})
