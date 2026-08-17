// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAction, waitForPageSettled, type PageSettlePolicy } from '../src/content/actions.ts'
import type { ElementIds } from '../src/content/ids.ts'

const POLICY: PageSettlePolicy = {
  minimumMs: 20,
  quietMs: 20,
  maxAfterReadyMs: 60,
  timeoutMs: 100,
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('waitForPageSettled', () => {
  it('returns as soon as the minimum quiet window completes', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    let resolved = false
    const pending = waitForPageSettled(POLICY).then((value) => {
      resolved = true
      return value
    })

    await vi.advanceTimersByTimeAsync(19)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(true)
  })

  it('extends the quiet window when the DOM changes', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    let resolved = false
    const pending = waitForPageSettled(POLICY).then((value) => {
      resolved = true
      return value
    })
    setTimeout(() => { document.body.setAttribute('data-state', 'updated') }, 15)

    await vi.advanceTimersByTimeAsync(34)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(true)
  })

  it('uses the post-readiness cap on continuously changing pages', async () => {
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('complete')
    let tick = 0
    const mutations = setInterval(() => {
      tick += 1
      document.body.setAttribute('data-tick', String(tick))
    }, 10)
    const pending = waitForPageSettled(POLICY)

    await vi.advanceTimersByTimeAsync(60)
    clearInterval(mutations)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toBe(true)
  })
})

describe('navigation action responses', () => {
  it('answers a link click before starting a potentially unloading navigation', async () => {
    vi.useFakeTimers()
    const link = document.createElement('a')
    link.href = 'https://example.com/next'
    link.scrollIntoView = vi.fn()
    link.click = vi.fn()
    const ids = { elementByIndex: vi.fn(() => link) } as unknown as ElementIds

    await expect(runAction('browser_click', { index: 1 }, {
      ids,
      budget: { maxItems: 20, maxForms: 10, maxChars: 2_000 },
    })).resolves.toMatchObject({
      text: expect.stringContaining('Clicked link [1]'),
      navigationPending: true,
    })
    expect(link.click).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(0)
    expect(link.click).toHaveBeenCalledOnce()
  })

  it('does not wait for a replacement document when a link opens a new tab', async () => {
    vi.useFakeTimers()
    const link = document.createElement('a')
    link.href = 'https://example.com/next'
    link.target = '_blank'
    link.scrollIntoView = vi.fn()
    link.click = vi.fn()
    const ids = { elementByIndex: vi.fn(() => link) } as unknown as ElementIds

    await expect(runAction('browser_click', { index: 1 }, {
      ids,
      budget: { maxItems: 20, maxForms: 10, maxChars: 2_000 },
    })).resolves.toEqual({ text: expect.stringContaining('outside the controlled frame') })

    await vi.advanceTimersByTimeAsync(0)
    expect(link.click).toHaveBeenCalledOnce()
  })
})
