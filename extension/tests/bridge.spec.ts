// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { BridgeClient, type BridgeState } from '../src/background/bridge.ts'

class FakeWebSocket extends EventTarget {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSED = 3
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.CONNECTING

  constructor(readonly url: string) {
    super()
    FakeWebSocket.instances.push(this)
  }

  send(): void {}

  close(): void {
    this.readyState = FakeWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  FakeWebSocket.instances = []
})

describe('BridgeClient connection probe', () => {
  it('waits without opening a WebSocket while the local bridge is unavailable', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const states: BridgeState[] = []
    const probe = vi.fn(async () => false)
    const client = new BridgeClient({
      onStateChange: (state) => { states.push(state) },
      onFrame: () => {},
      onHelloOk: () => {},
    }, probe)

    client.start('ws://127.0.0.1:3080/ext/bridge', '')
    await vi.advanceTimersByTimeAsync(0)

    expect(probe).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(states.at(-1)).toBe('reconnecting')
    client.stop()
  })

  it('opens the WebSocket after the probe succeeds', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const client = new BridgeClient({
      onStateChange: () => {},
      onFrame: () => {},
      onHelloOk: () => {},
    }, async () => true)

    client.start('ws://127.0.0.1:3080/ext/bridge', '')
    await vi.advanceTimersByTimeAsync(0)

    expect(FakeWebSocket.instances).toHaveLength(1)
    client.stop()
  })
})

describe('BridgeClient hello version', () => {
  it('sends the extension manifest version in hello and forwards the plugin version from hello.ok', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('browser', { runtime: { getManifest: () => ({ version: '0.4.6' }) } })
    const sent: string[] = []
    let helloOk: { caps: unknown; version?: string } | null = null
    const client = new BridgeClient({
      onStateChange: () => {},
      onFrame: () => {},
      onHelloOk: (caps, version) => { helloOk = { caps, version } },
    }, async () => true)

    client.start('ws://127.0.0.1:3080/ext/bridge', 'tok')
    await vi.advanceTimersByTimeAsync(0)
    const socket = FakeWebSocket.instances[0]!
    vi.spyOn(socket, 'send').mockImplementation(((data: unknown) => { sent.push(String(data)) }) as () => void)
    socket.readyState = FakeWebSocket.OPEN
    socket.dispatchEvent(new Event('open'))
    await vi.advanceTimersByTimeAsync(0)

    const hello = JSON.parse(sent[0]!) as { t: string; version?: string }
    expect(hello.t).toBe('hello')
    expect(hello.version).toBe('0.4.6')

    socket.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ t: 'hello.ok', caps: { snapshotMaxChars: 12000, maxInteractiveItems: 60 }, version: '0.4.5' }),
    }))
    await vi.advanceTimersByTimeAsync(0)
    expect(helloOk).not.toBeNull()
    expect(helloOk!.version).toBe('0.4.5')
    client.stop()
  })
})
