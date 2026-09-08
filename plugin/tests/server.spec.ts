import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { BridgeServer, BridgeToolError, isLoopbackAddress, messageToText, payloadCode, payloadMessage } from '../src/server.ts'
import type { BridgeFrame, RemoteWireResult } from '../src/protocol.ts'

const TOKEN = 'deadbeefdeadbeefdeadbeefdeadbeef'

/** 扩展上下文的 Origin（回环免 token 的必要条件）。 */
const EXT_ORIGIN = 'chrome-extension://test-extension-id'

/** Extension caps used by every hello in this suite. */
const CAPS = { textOnly: true as const, snapshotMaxChars: 12_000, maxInteractiveItems: 60 }

interface Harness {
  bridge: BridgeServer
  server: Server
  url: string
  dispatchMock: ReturnType<typeof vi.fn>
  streamMock: ReturnType<typeof vi.fn>
}

async function startBridge(overrides: Partial<ConstructorParameters<typeof BridgeServer>[0]> = {}): Promise<Harness> {
  const dispatchMock = vi.fn(async (): Promise<RemoteWireResult> => ({ ok: true, value: 'ok' }))
  const streamMock = vi.fn(async () => (async function* () { /* no frames */ })())
  const bridge = new BridgeServer({
    token: TOKEN,
    dispatchRpc: dispatchMock,
    openStream: streamMock,
    toolTimeoutMs: 1_000,
    caps: { textOnly: true, snapshotMaxChars: 12_000, maxInteractiveItems: 60 },
    ...overrides,
  })
  const server = createServer()
  server.on('upgrade', (req, socket, head) => { bridge.handleUpgrade(req, socket, head) })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  const port = (server.address() as AddressInfo).port
  return { bridge, server, url: `ws://127.0.0.1:${port}/ext/bridge`, dispatchMock, streamMock }
}

function connect(url: string, origin?: string): Promise<{ ws: WebSocket; frames: BridgeFrame[]; done: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin !== undefined ? { headers: { origin } } : undefined)
    const frames: BridgeFrame[] = []
    ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as BridgeFrame) })
    ws.on('error', reject)
    ws.on('open', () => {
      resolve({
        ws,
        frames,
        done: new Promise<void>((doneResolve) => {
          ws.on('close', () => { doneResolve() })
        }),
      })
    })
  })
}

function send(ws: WebSocket, frame: BridgeFrame): void {
  ws.send(JSON.stringify(frame))
}

async function hello(ws: WebSocket, frames: BridgeFrame[]): Promise<void> {
  send(ws, { t: 'hello', token: TOKEN, caps: CAPS })
  await waitFor(() => frames.some((f) => f.t === 'hello.ok'))
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
}

const harnesses: Harness[] = []
afterEach(async () => {
  for (const h of harnesses.splice(0)) {
    await h.bridge.close()
    await new Promise<void>((resolve) => { h.server.close(() => resolve()) })
  }
})

describe('BridgeServer', () => {
  it('decodes every ws message delivery shape', () => {
    expect(messageToText([Buffer.from('a'), Buffer.from('b')])).toBe('ab')
    expect(messageToText(Buffer.from('hi'))).toBe('hi')
    expect(messageToText(new TextEncoder().encode('x').buffer)).toBe('x')
  })

  it('extracts tool error codes and messages with parser-gated fallbacks', () => {
    expect(payloadCode({ code: 'timeout', message: 'm' })).toBe('timeout')
    expect(payloadCode({ code: 42, message: 'm' })).toBe('internal')
    expect(payloadCode('garbage')).toBe('internal')
    expect(payloadCode(null)).toBe('internal')
    expect(payloadMessage({ code: 'x', message: 'm' })).toBe('m')
    expect(payloadMessage({ code: 'x', message: '' })).toBe('browser action failed')
    expect(payloadMessage({ code: 'x', message: 42 })).toBe('browser action failed')
    expect(payloadMessage('garbage')).toBe('browser action failed')
  })

  it('authenticates a valid hello and acknowledges caps', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    send(ws, { t: 'hello', token: TOKEN, caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } })
    await waitFor(() => frames.some((f) => f.t === 'hello.ok'))
    expect(frames.find((f) => f.t === 'hello.ok')).toEqual({ t: 'hello.ok', caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } })
    ws.close()
  })

  it('accepts loopback connections without a token when Origin is an extension (zero-config mode)', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url, EXT_ORIGIN)
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await waitFor(() => frames.some((f) => f.t === 'hello.ok'))
    expect(frames.find((f) => f.t === 'hello.ok')).toBeDefined()
    ws.close()
  })

  it('rejects loopback connections without a token when Origin is not an extension (malicious page)', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, done } = await connect(h.url, 'https://evil.example')
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('rejects loopback connections without a token and without any Origin', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, done } = await connect(h.url)
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('requires the token from loopback moz-extension origins (per-install UUID is not an identity)', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, done } = await connect(h.url, 'moz-extension://9c8f7a2b-1111-4222-8333-444455556666')
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('accepts loopback moz-extension origins that present the token', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url, 'moz-extension://9c8f7a2b-1111-4222-8333-444455556666')
    send(ws, { t: 'hello', token: TOKEN, caps: CAPS })
    await waitFor(() => frames.some((f) => f.t === 'hello.ok'))
    expect(frames.find((f) => f.t === 'hello.ok')).toBeDefined()
    ws.close()
  })

  it('still requires the token from non-loopback remotes', async () => {
    const h = await startBridge({ remoteAddressOverride: '192.168.1.5' })
    harnesses.push(h)
    const { ws, done } = await connect(h.url)
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('closes sockets that never present hello', async () => {
    const h = await startBridge({ helloTimeoutMs: 500 })
    harnesses.push(h)
    const { ws, done } = await connect(h.url)
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('rejects frames before hello', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, done } = await connect(h.url)
    send(ws, { t: 'pong' })
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('passes rpc frames to dispatchRpc with native args and relays the RemoteResult', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'rpc', id: 'rpc-1', method: 'session/list', args: { _request: {} } })
    await waitFor(() => frames.some((f) => f.t === 'rpc.result'))
    const result = frames.find((f) => f.t === 'rpc.result')
    expect(result).toMatchObject({ t: 'rpc.result', id: 'rpc-1', ok: true, value: 'ok' })
    expect(h.dispatchMock).toHaveBeenCalledTimes(1)
    expect(h.dispatchMock).toHaveBeenCalledWith('session/list', { _request: {} }, expect.any(AbortSignal))
    ws.close()
  })

  it('relays business failures as rpc.result errors', async () => {
    const h = await startBridge({
      dispatchRpc: async (): Promise<RemoteWireResult> => ({
        ok: false,
        error: { code: 'session/not-found', message: 'no such session', details: {} },
      }),
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'rpc', id: 'rpc-2', method: 'session/cancel', args: { request: { sessionId: 'gone' } } })
    await waitFor(() => frames.some((f) => f.t === 'rpc.result' && f.id === 'rpc-2'))
    expect(frames.find((f) => f.t === 'rpc.result' && f.id === 'rpc-2'))
      .toMatchObject({ t: 'rpc.result', id: 'rpc-2', ok: false, error: { code: 'session/not-found', message: 'no such session' } })
    ws.close()
  })

  it('maps a thrown dispatch failure to an internal rpc.result error', async () => {
    const h = await startBridge({
      dispatchRpc: async () => { throw new Error('boom') },
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'rpc', id: 'rpc-4', method: 'session/list', args: { _request: {} } })
    await waitFor(() => frames.some((f) => f.t === 'rpc.result' && f.id === 'rpc-4'))
    expect(frames.find((f) => f.t === 'rpc.result' && f.id === 'rpc-4'))
      .toMatchObject({ t: 'rpc.result', id: 'rpc-4', ok: false, error: { code: 'internal', message: 'Error: boom' } })
    ws.close()
  })

  it('rejects privileged methods from non-loopback remotes', async () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.5')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('dispatches tool calls and resolves on tool.result', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const result = h.bridge.requestTool('browser_click', { index: 1 }, new AbortController().signal)
    await waitFor(() => frames.some((f) => f.t === 'tool.call'))
    const call = frames.find((f) => f.t === 'tool.call') as Extract<BridgeFrame, { t: 'tool.call' }>
    expect(call.name).toBe('browser_click')
    expect(call.args).toEqual({ index: 1 })
    send(ws, { t: 'tool.result', id: call.id, ok: true, result: { text: 'clicked' } })
    await expect(result).resolves.toEqual({ text: 'clicked' })
    ws.close()
  })

  it('sends expiresAt on tool.call and withdraws the call with tool.cancel on timeout', async () => {
    const h = await startBridge({ toolTimeoutMs: 80 })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const before = Date.now()
    const result = h.bridge.requestTool('browser_click', { index: 1 }, new AbortController().signal)
    await waitFor(() => frames.some((f) => f.t === 'tool.call'))
    const call = frames.find((f) => f.t === 'tool.call') as Extract<BridgeFrame, { t: 'tool.call' }>
    expect(typeof call.expiresAt).toBe('number')
    expect(call.expiresAt!).toBeGreaterThanOrEqual(before + 80)
    // 扩展不应答：超时后必须在网线上撤回该调用。
    await expect(result).rejects.toMatchObject({ code: 'timeout' })
    await waitFor(() => frames.some((f) => f.t === 'tool.cancel' && (f as { id: string }).id === call.id))
    ws.close()
  })

  it('withdraws tool calls with tool.cancel when the caller signal fires', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const controller = new AbortController()
    const result = h.bridge.requestTool('browser_click', { index: 1 }, controller.signal)
    await waitFor(() => frames.some((f) => f.t === 'tool.call'))
    const call = frames.find((f) => f.t === 'tool.call') as Extract<BridgeFrame, { t: 'tool.call' }>
    controller.abort()
    await expect(result).rejects.toMatchObject({ code: 'bridge-closed' })
    await waitFor(() => frames.some((f) => f.t === 'tool.cancel' && (f as { id: string }).id === call.id))
    ws.close()
  })

  it('preserves arrival order for session-scoped prompt/cancel rpc frames', async () => {
    const calls: string[] = []
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    const h = await startBridge({
      dispatchRpc: async (method: string, args: Record<string, unknown>): Promise<RemoteWireResult> => {
        const requestId = (args.request as { requestId?: string }).requestId ?? method
        calls.push(requestId)
        if (requestId === 'p1') await gate
        return { ok: true, value: null }
      },
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'rpc', id: 'r1', method: 'session/prompt', args: { request: { sessionId: 's1', requestId: 'p1' } } })
    send(ws, { t: 'rpc', id: 'r2', method: 'session/cancel', args: { request: { sessionId: 's1' } } })
    // 无序时 cancel 会立即进入 handler；有序时它必须等 p1 的 dispatch 完成。
    await new Promise((resolve) => { setTimeout(resolve, 60) })
    expect(calls).toEqual(['p1'])
    releaseFirst()
    await waitFor(() => calls.length === 2)
    expect(calls).toEqual(['p1', 'session/cancel'])
    await waitFor(() => frames.some((f) => f.t === 'rpc.result' && f.id === 'r2'))
    ws.close()
  })

  it('rejects tool calls whose signal is already aborted before dispatch', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url, EXT_ORIGIN)
    send(ws, { t: 'hello', token: '', caps: CAPS })
    await waitFor(() => frames.some((f) => f.t === 'hello.ok'))
    const abort = new AbortController()
    abort.abort()
    expect(() => h.bridge.requestTool('browser_click', {}, abort.signal))
      .toThrowError(expect.objectContaining({ code: 'bridge-closed' }))
    // 没有 tool.call 被发出
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(frames.some((f) => f.t === 'tool.call')).toBe(false)
    ws.close()
  })

  it('rejects tool calls when no extension is connected', async () => {
    const h = await startBridge()
    harnesses.push(h)
    expect(() => h.bridge.requestTool('browser_click', {}, new AbortController().signal))
      .toThrowError(expect.objectContaining({ code: 'bridge-closed' }))
  })

  it('times out tool calls that never settle', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    await expect(h.bridge.requestTool('browser_wait', {}, new AbortController().signal, 30))
      .rejects.toMatchObject({ code: 'timeout' })
    ws.close()
  })

  it('propagates extension-reported tool errors', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const result = h.bridge.requestTool('browser_navigate', { url: 'https://x' }, new AbortController().signal)
    await waitFor(() => frames.some((f) => f.t === 'tool.call'))
    const call = frames.find((f) => f.t === 'tool.call') as Extract<BridgeFrame, { t: 'tool.call' }>
    send(ws, { t: 'tool.result', id: call.id, ok: false, error: { code: 'action-failed', message: 'blocked' } })
    await expect(result).rejects.toBeInstanceOf(BridgeToolError)
    await expect(result).rejects.toMatchObject({ code: 'action-failed', message: 'blocked' })
    ws.close()
  })

  it('settles pending tool calls when a replacement connection arrives', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const first = await connect(h.url)
    await hello(first.ws, first.frames)
    const pending = h.bridge.requestTool('browser_click', {}, new AbortController().signal)
    // Attach the assertion eagerly: the replacement below settles it before the final await.
    const pendingAssertion = expect(pending).rejects.toMatchObject({ code: 'bridge-closed' })
    await waitFor(() => first.frames.some((f) => f.t === 'tool.call'))

    const second = await connect(h.url)
    await hello(second.ws, second.frames)

    await pendingAssertion
    first.ws.close()
    second.ws.close()
  })

  it('aborts tool calls when the caller signal fires', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const abort = new AbortController()
    const pending = h.bridge.requestTool('browser_click', {}, abort.signal)
    await waitFor(() => frames.some((f) => f.t === 'tool.call'))
    abort.abort()
    await expect(pending).rejects.toMatchObject({ code: 'bridge-closed' })
    ws.close()
  })

  it('pumps native stream frames under the subscription id', async () => {
    const h = await startBridge({
      openStream: async (method: string, args: Record<string, unknown>) => {
        expect(method).toBe('session/follow')
        expect(args).toEqual({ request: { address: { kind: 'session', sessionId: 's1' } } })
        return (async function* () {
          yield { type: 'snapshot', records: [] }
          yield { type: 'event', event: { type: 'user/message', seq: 1 } }
        })()
      },
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'stream.open', id: 'st-1', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 's1' } } } })
    await waitFor(() => frames.filter((f) => f.t === 'stream.frame').length >= 2)
    const streamFrames = frames.filter((f) => f.t === 'stream.frame') as Extract<BridgeFrame, { t: 'stream.frame' }>[]
    expect(streamFrames.map((f) => f.id)).toEqual(['st-1', 'st-1'])
    expect((streamFrames[1]!.frame as { type: string }).type).toBe('event')
    ws.close()
  })

  it('aborts the stream on stream.close and stops pumping', async () => {
    let observedSignal: AbortSignal | undefined
    const h = await startBridge({
      openStream: async (_method: string, _args: Record<string, unknown>, signal: AbortSignal) => {
        observedSignal = signal
        return (async function* () {
          yield { type: 'baseline', value: { items: [] } }
          await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        })()
      },
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'stream.open', id: 'st-2', method: 'workspace/follow', args: {} })
    await waitFor(() => frames.some((f) => f.t === 'stream.frame'))
    send(ws, { t: 'stream.close', id: 'st-2' })
    await waitFor(() => observedSignal?.aborted === true)
    ws.close()
  })

  it('reports stream failures as stream.error and lets the client reopen', async () => {
    let attempts = 0
    const h = await startBridge({
      openStream: async () => {
        attempts += 1
        if (attempts === 1) return (async function* () { throw new Error('session not found') })()
        return (async function* () { yield { type: 'snapshot', records: [] } })()
      },
    })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'stream.open', id: 'st-3', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 'gone' } } } })
    await waitFor(() => frames.some((f) => f.t === 'stream.error' && f.id === 'st-3'))
    expect(frames.find((f) => f.t === 'stream.error')).toMatchObject({ t: 'stream.error', id: 'st-3', message: 'Error: session not found' })
    // Reopening the same id works after the failure.
    send(ws, { t: 'stream.open', id: 'st-3', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 's1' } } } })
    await waitFor(() => frames.some((f) => f.t === 'stream.frame' && f.id === 'st-3'))
    ws.close()
  })

  it('aborts all streams when a replacement connection arrives', async () => {
    const signals: AbortSignal[] = []
    const h = await startBridge({
      openStream: async (_method: string, _args: Record<string, unknown>, signal: AbortSignal) => {
        signals.push(signal)
        return (async function* () {
          await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
        })()
      },
    })
    harnesses.push(h)
    const first = await connect(h.url)
    await hello(first.ws, first.frames)
    send(first.ws, { t: 'stream.open', id: 'st-a', method: 'workspace/follow', args: {} })
    send(first.ws, { t: 'stream.open', id: 'st-b', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 's1' } } } })
    await waitFor(() => signals.length === 2)

    const second = await connect(h.url)
    await hello(second.ws, second.frames)

    await waitFor(() => signals.every((signal) => signal.aborted))
    first.ws.close()
    second.ws.close()
  })

  it('rejects privileged stream opens from non-loopback remotes', async () => {
    const h = await startBridge({ remoteAddressOverride: '192.168.1.5' })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'stream.open', id: 'st-p', method: 'settings/describe', args: {} })
    await waitFor(() => frames.some((f) => f.t === 'stream.error' && f.id === 'st-p'))
    expect(h.streamMock).not.toHaveBeenCalled()
    ws.close()
  })

  it('closes cleanly twice (second close is a no-op on the acceptor)', async () => {
    const h = await startBridge()
    harnesses.push(h)
    await h.bridge.close()
    await h.bridge.close()
  })

  it('sends protocol pings on the configured cadence and the client answers pong', async () => {
    const h = await startBridge({ pingIntervalMs: 50 })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    await waitFor(() => frames.some((f) => f.t === 'ping'))
    send(ws, { t: 'pong' })
    ws.close()
  })

  it('closes cleanly and rejects pending work', async () => {
    const h = await startBridge()
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    const pending = h.bridge.requestTool('browser_click', {}, new AbortController().signal)
    // Attach the assertion eagerly: close() settles it before the final await.
    const pendingAssertion = expect(pending).rejects.toMatchObject({ code: 'bridge-closed' })
    await h.bridge.close()
    await pendingAssertion
    expect(() => h.bridge.requestTool('browser_click', {}, new AbortController().signal))
      .toThrowError(expect.objectContaining({ code: 'bridge-closed' }))
    ws.close()
  })

  it('tracks connection state through auth, close, and replacement', async () => {
    const h = await startBridge()
    harnesses.push(h)
    expect(h.bridge.hasConnection()).toBe(false)
    const { ws, frames, done } = await connect(h.url)
    await hello(ws, frames)
    expect(h.bridge.hasConnection()).toBe(true)
    ws.close()
    await done
    // The server processes the close asynchronously; poll for the outcome.
    await expect.poll(() => h.bridge.hasConnection()).toBe(false)
  })

  it('closes sockets on unparseable frames and ignores client-only frames when ready', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames, done } = await connect(h.url)
    await hello(ws, frames)
    // Client-only shapes after ready are ignored (no error frame, no close).
    send(ws, { t: 'pong' })
    send(ws, { t: 'hello', token: TOKEN, caps: CAPS })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    // Garbage is a protocol violation and closes the socket.
    ws.send('not-json')
    await done
    expect(ws.readyState).toBe(WebSocket.CLOSED)
  })

  it('ignores tool results with unknown ids', async () => {
    const h = await startBridge()
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    // Unknown id: ignored, connection stays healthy.
    send(ws, { t: 'tool.result', id: 'nope', ok: true, result: {} })
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(ws.readyState).toBe(WebSocket.OPEN)
    ws.close()
  })

  it('rejects privileged methods from non-loopback remotes over a real socket', async () => {
    // The sandbox cannot bind arbitrary loopback literals, so the remote
    // address is forced through the test seam; the socket itself is real.
    const h = await startBridge({ remoteAddressOverride: '192.168.1.5' })
    harnesses.push(h)
    const { ws, frames } = await connect(h.url)
    await hello(ws, frames)
    send(ws, { t: 'rpc', id: 'priv-1', method: 'settings/describe', args: {} })
    await waitFor(() => frames.some((f) => f.t === 'rpc.result' && f.id === 'priv-1'))
    expect(frames.find((f) => f.t === 'rpc.result' && f.id === 'priv-1'))
      .toMatchObject({ t: 'rpc.result', id: 'priv-1', ok: false, error: { code: 'forbidden' } })
    // Non-privileged methods still pass for the same remote.
    send(ws, { t: 'rpc', id: 'priv-2', method: 'session/list', args: { _request: {} } })
    await waitFor(() => frames.some((f) => f.t === 'rpc.result' && f.id === 'priv-2'))
    const allowed = frames.find((f): f is Extract<BridgeFrame, { t: 'rpc.result' }> => f.t === 'rpc.result' && f.id === 'priv-2')!
    expect(allowed.ok).toBe(true)
    ws.close()
  })
})
