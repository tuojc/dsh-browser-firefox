// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createRpc } from '../src/background/rpc.ts'
import type { BridgeClient, BridgeSinks } from '../src/background/bridge.ts'
import type { ServerFrame } from 'dsh-browser-firefox/src/protocol.ts'

/** Minimal BridgeClient stub: sinks 对象共享引用，connected/send 可控。 */
function fakeBridge(): { bridge: BridgeClient; sinks: BridgeSinks; send: ReturnType<typeof vi.fn> } {
  const sinks: BridgeSinks = { onStateChange: () => {}, onFrame: () => {}, onHelloOk: () => {} }
  const send = vi.fn(() => true)
  const bridge = { sinks, connected: true, send } as unknown as BridgeClient
  return { bridge, sinks, send }
}

describe('createRpc fail-fast', () => {
  it('rejects all pending requests immediately when the bridge leaves connected state', async () => {
    const { bridge, sinks } = fakeBridge()
    const rpc = createRpc(bridge)
    const first = rpc.request('session/list', { _request: {} })
    const second = rpc.request('workspace/list', { request: {} })

    sinks.onStateChange('reconnecting')

    await expect(first).rejects.toThrow('bridge connection lost')
    await expect(second).rejects.toThrow('bridge connection lost')
    // 已结算的请求被移除：重复的状态翻转不应再次触发任何回调。
    sinks.onStateChange('stopped')
    sinks.onStateChange('connected')
  })

  it('still resolves a request answered by rpc.result while connected', async () => {
    const { bridge, sinks, send } = fakeBridge()
    const rpc = createRpc(bridge)
    const promise = rpc.request('session/list', { _request: {} })
    const id = (send.mock.calls[0]?.[0] as { id: string }).id
    sinks.onFrame({ t: 'rpc.result', id, ok: true, value: { sessions: [] } } as ServerFrame)
    await expect(promise).resolves.toEqual({ sessions: [] })
  })

  it('keeps the 30s timeout as a backstop while connected', async () => {
    vi.useFakeTimers()
    try {
      const { bridge } = fakeBridge()
      const rpc = createRpc(bridge)
      const promise = rpc.request('session/list', { _request: {} })
      const assertion = expect(promise).rejects.toThrow('timed out')
      await vi.advanceTimersByTimeAsync(30_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })
})
