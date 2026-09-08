import { describe, expect, it } from 'vitest'
import { isClientFrame, isServerFrame, parseBridgeFrame } from '../src/protocol.ts'

describe('parseBridgeFrame', () => {
  it('parses a valid hello frame', () => {
    const frame = parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'abc123', caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } }))
    expect(frame).toEqual({ t: 'hello', token: 'abc123', caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } })
  })

  it('rejects hello with wrong caps shape', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'x', caps: { textOnly: false, snapshotMaxChars: 100, maxInteractiveItems: 10 } }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'x', caps: { textOnly: true } }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'x', caps: { textOnly: true, snapshotMaxChars: 0, maxInteractiveItems: 10 } }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello', token: 'x' }))).toBeUndefined()
  })

  it('parses rpc, stream, and tool frames with native args', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc', id: '1', method: 'session/list', args: { _request: {} } })))
      .toEqual({ t: 'rpc', id: '1', method: 'session/list', args: { _request: {} } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.open', id: 's1', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 'x' } } } })))
      .toEqual({ t: 'stream.open', id: 's1', method: 'session/follow', args: { request: { address: { kind: 'session', sessionId: 'x' } } } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.close', id: 's1' })))
      .toEqual({ t: 'stream.close', id: 's1' })
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.result', id: '2', ok: true, result: { text: 'ok' } })))
      .toEqual({ t: 'tool.result', id: '2', ok: true, result: { text: 'ok' } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.result', id: '3', ok: false, error: { code: 'timeout', message: 'm' } })))
      .toEqual({ t: 'tool.result', id: '3', ok: false, error: { code: 'timeout', message: 'm' } })
  })

  it('rejects rpc/stream.open frames without a plain-object args', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc', id: '1', method: 'session/list' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc', id: '1', method: 'session/list', args: [] }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.open', id: 's1', method: 'workspace/follow' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.close' }))).toBeUndefined()
  })

  it('parses server-side frames the extension receives', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello.ok', caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } })))
      .toEqual({ t: 'hello.ok', caps: { textOnly: true, snapshotMaxChars: 12000, maxInteractiveItems: 60 } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.frame', id: 's1', frame: { type: 'snapshot', records: [] } })))
      .toEqual({ t: 'stream.frame', id: 's1', frame: { type: 'snapshot', records: [] } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.error', id: 's1', message: 'session not found' })))
      .toEqual({ t: 'stream.error', id: 's1', message: 'session not found' })
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: '4', name: 'browser_click', args: { index: 1 } })))
      .toEqual({ t: 'tool.call', id: '4', name: 'browser_click', args: { index: 1 } })
  })

  it('parses tool.call expiresAt and tool.cancel frames', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: 'a', name: 'browser_click', args: {}, expiresAt: 1234567890 })))
      .toEqual({ t: 'tool.call', id: 'a', name: 'browser_click', args: {}, expiresAt: 1234567890 })
    // 兼容 0.3.0 及更早的插件：缺省 expiresAt 仍解析。
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: 'a', name: 'browser_click', args: {} })))
      .toEqual({ t: 'tool.call', id: 'a', name: 'browser_click', args: {} })
    // 非法 expiresAt（非正数 / 非数字）整体拒收。
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: 'a', name: 'x', args: {}, expiresAt: -1 }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: 'a', name: 'x', args: {}, expiresAt: 'soon' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.cancel', id: 'a' }))).toEqual({ t: 'tool.cancel', id: 'a' })
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.cancel' }))).toBeUndefined()
    const cancel = parseBridgeFrame(JSON.stringify({ t: 'tool.cancel', id: 'a' }))!
    expect(isServerFrame(cancel)).toBe(true)
    expect(isClientFrame(cancel)).toBe(false)
  })

  it('parses rpc.result success and error forms', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc.result', id: '1', ok: true, value: { x: 1 } })))
      .toEqual({ t: 'rpc.result', id: '1', ok: true, value: { x: 1 } })
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc.result', id: '1', ok: false, error: { code: 'gateway/internal', message: 'boom' } })))
      .toEqual({ t: 'rpc.result', id: '1', ok: false, error: { code: 'gateway/internal', message: 'boom' } })
    // ok:true without value, and ok:false without error, are malformed.
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc.result', id: '1', ok: true }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc.result', id: '1', ok: false }))).toBeUndefined()
  })

  it('parses ping and error frames', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'ping' }))).toEqual({ t: 'ping' })
    expect(parseBridgeFrame(JSON.stringify({ t: 'error', code: 'stream-failed', message: 'x' })))
      .toEqual({ t: 'error', code: 'stream-failed', message: 'x' })
    expect(parseBridgeFrame(JSON.stringify({ t: 'error', code: 1, message: 'x' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'pong' }))).toEqual({ t: 'pong' })
  })

  it('rejects stream.error frames with a non-string message', () => {
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.error', id: 's1' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'stream.error', id: 5, message: 'x' }))).toBeUndefined()
  })

  it('classifies frames by sender side', () => {
    const server = parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: '1', name: 'browser_click', args: {} }))!
    const client = parseBridgeFrame(JSON.stringify({ t: 'hello', token: 't', caps: { textOnly: true, snapshotMaxChars: 100, maxInteractiveItems: 10 } }))!
    expect(isServerFrame(server)).toBe(true)
    expect(isClientFrame(server)).toBe(false)
    expect(isServerFrame(client)).toBe(false)
    expect(isClientFrame(client)).toBe(true)
    for (const t of ['hello.ok', 'rpc.result', 'stream.frame', 'stream.error', 'tool.call', 'ping', 'error'] as const) {
      const frame = parseBridgeFrame(JSON.stringify(serverShape(t)))!
      expect(isServerFrame(frame)).toBe(true)
    }
    for (const t of ['hello', 'rpc', 'stream.open', 'stream.close', 'tool.result', 'pong'] as const) {
      const frame = parseBridgeFrame(JSON.stringify(clientShape(t)))!
      expect(isClientFrame(frame)).toBe(true)
    }
  })

  it('rejects malformed payloads', () => {
    expect(parseBridgeFrame('not json')).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify(null))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify([1, 2]))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({}))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'nope' }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc', id: 5, method: 'x', args: {} }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.result', id: '1', ok: true }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.result', id: 5, ok: true, result: {} }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'rpc.result', id: 5, ok: true, value: {} }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'hello.ok', caps: { textOnly: true } }))).toBeUndefined()
    expect(parseBridgeFrame(JSON.stringify({ t: 'tool.call', id: '1', name: 'x', args: [] }))).toBeUndefined()
  })
})

/** Minimal valid shape per server-side frame type (for classification tests). */
function serverShape(t: 'hello.ok' | 'rpc.result' | 'stream.frame' | 'stream.error' | 'tool.call' | 'ping' | 'error'): Record<string, unknown> {
  switch (t) {
    case 'hello.ok': return { t, caps: { textOnly: true, snapshotMaxChars: 100, maxInteractiveItems: 10 } }
    case 'rpc.result': return { t, id: '1', ok: true, value: {} }
    case 'stream.frame': return { t, id: '1', frame: { type: 'baseline' } }
    case 'stream.error': return { t, id: '1', message: 'm' }
    case 'tool.call': return { t, id: '1', name: 'x', args: {} }
    case 'ping': return { t }
    case 'error': return { t, code: 'x', message: 'm' }
  }
}

/** Minimal valid shape per client-side frame type (for classification tests). */
function clientShape(t: 'hello' | 'rpc' | 'stream.open' | 'stream.close' | 'tool.result' | 'pong'): Record<string, unknown> {
  switch (t) {
    case 'hello': return { t, token: 'x', caps: { textOnly: true, snapshotMaxChars: 100, maxInteractiveItems: 10 } }
    case 'rpc': return { t, id: '1', method: 'x', args: {} }
    case 'stream.open': return { t, id: '1', method: 'workspace/follow', args: {} }
    case 'stream.close': return { t, id: '1' }
    case 'tool.result': return { t, id: '1', ok: true, result: {} }
    case 'pong': return { t }
  }
}
