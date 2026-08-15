// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InteractionResponseRouter } from '../src/background/responses.ts'

const MESSAGES = {
  unavailable: 'unavailable',
  timeout: 'timed out',
  duplicate: 'duplicate',
}

afterEach(() => {
  vi.useRealTimers()
})

function panelPort(): { postMessage: ReturnType<typeof vi.fn<(message: unknown) => void>> } {
  return { postMessage: vi.fn<(message: unknown) => void>() }
}

describe('InteractionResponseRouter', () => {
  it('routes each receipt only to the panel that originated it', () => {
    const router = new InteractionResponseRouter()
    const first = panelPort()
    const second = panelPort()
    router.begin(first, 'first-id', () => true, MESSAGES)
    router.begin(second, 'second-id', () => true, MESSAGES)

    router.route({ t: 'respond.result', id: 'second-id', ok: true, result: { accepted: true } })

    expect(first.postMessage).not.toHaveBeenCalled()
    expect(second.postMessage).toHaveBeenCalledWith({
      type: 'respond.result', id: 'second-id', ok: true, result: { accepted: true },
    })
  })

  it('rejects duplicate ids without replacing the original owner', () => {
    const router = new InteractionResponseRouter()
    const first = panelPort()
    const second = panelPort()
    router.begin(first, 'same-id', () => true, MESSAGES)
    router.begin(second, 'same-id', () => true, MESSAGES)
    router.route({ t: 'respond.result', id: 'same-id', ok: true, result: { accepted: true } })

    expect(second.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'respond.result', id: 'same-id', ok: false, error: { code: 'duplicate-id', message: 'duplicate' },
    }))
    expect(first.postMessage).toHaveBeenCalledWith(expect.objectContaining({ ok: true }))
  })

  it('settles pending responses when dispatch fails, times out, or the bridge drops', () => {
    vi.useFakeTimers()
    const router = new InteractionResponseRouter(100)
    const port = panelPort()
    router.begin(port, 'offline', () => false, MESSAGES)
    router.begin(port, 'timeout', () => true, MESSAGES)
    vi.advanceTimersByTime(100)
    router.begin(port, 'disconnect', () => true, MESSAGES)
    router.failAll('disconnected')

    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'offline', error: { code: 'bridge-unavailable', message: 'unavailable' } }))
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'timeout', error: { code: 'timeout', message: 'timed out' } }))
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'disconnect', error: { code: 'bridge-disconnected', message: 'disconnected' } }))
  })

  it('forgets a panel response when that panel closes', () => {
    const router = new InteractionResponseRouter()
    const port = panelPort()
    router.begin(port, 'closed', () => true, MESSAGES)
    router.removePort(port)
    router.route({ t: 'respond.result', id: 'closed', ok: true, result: { accepted: true } })
    expect(port.postMessage).not.toHaveBeenCalled()
  })
})
