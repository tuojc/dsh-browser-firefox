// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApprovalCoordinator } from '../src/background/approval-coordinator.ts'

const PROMPT = {
  kind: 'action' as const,
  action: 'browser_click',
  summary: 'Click element [3]',
  origins: ['https://example.com'],
  canTrust: true,
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function harness(delivered = false) {
  const callbacks = {
    deliver: vi.fn(() => delivered),
    notify: vi.fn(),
    clearNotification: vi.fn(),
    resolved: vi.fn(),
  }
  const coordinator = new ApprovalCoordinator(callbacks, 60_000)
  return { callbacks, coordinator }
}

describe('ApprovalCoordinator', () => {
  it('keeps an undelivered approval pending and notifies the user', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abc')
    const { callbacks, coordinator } = harness()
    const pending = coordinator.request(PROMPT, new AbortController().signal, 7, 'session-1')

    expect(callbacks.notify).toHaveBeenCalledWith(expect.objectContaining({
      id: '12345678-1234-4234-8234-123456789abc',
      sessionId: 'session-1',
    }), 7)

    coordinator.replay((request) => {
      expect(request.sessionId).toBe('session-1')
      return true
    })
    coordinator.respond('12345678-1234-4234-8234-123456789abc', 'allow-once')

    await expect(pending).resolves.toEqual({ status: 'decision', decision: 'allow-once' })
    expect(callbacks.clearNotification).toHaveBeenCalledWith('12345678-1234-4234-8234-123456789abc')
    expect(callbacks.resolved).toHaveBeenCalledWith('12345678-1234-4234-8234-123456789abc')
  })

  it('waits for the full approval window before timing out', async () => {
    vi.useFakeTimers()
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abd')
    const { coordinator } = harness()
    const pending = coordinator.request(PROMPT, new AbortController().signal, 7)

    await vi.advanceTimersByTimeAsync(59_999)
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)

    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({ status: 'timed-out' })
  })

  it('cancels a pending approval when its tool call is withdrawn', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abe')
    const { coordinator } = harness(true)
    const abort = new AbortController()
    const pending = coordinator.request(PROMPT, abort.signal, 7)

    abort.abort()

    await expect(pending).resolves.toEqual({ status: 'cancelled' })
  })
})
