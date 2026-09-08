/**
 * Bridge WebSocket carrier: token-authenticated connection registry, Typert
 * Remote passthrough (unary + streams), and tool-call dispatch to the
 * connected browser extension.
 *
 * The route this server mounts (`/ext/bridge`) lives OUTSIDE the /api trust
 * fence (which only guards the client-connection routes), so the bridge brings
 * its own authentication: a bearer token presented in the `hello` frame within
 * HELLO_TIMEOUT_MS. RPC and stream frames speak the alpha Typert dialect
 * verbatim: slash-joined endpoints, native `args` objects, and unmodified
 * follow frames. Methods the bridge pins to loopback (`PRIVILEGED_METHODS`)
 * stay loopback-only here regardless of the token, defense in depth for
 * `--host 0.0.0.0` deployments.
 *
 * One active connection at a time: a new authenticated socket replaces the
 * previous one (the old socket is closed, its in-flight tool calls settle as
 * `bridge-closed`, and its streams are aborted).
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocket, WebSocketServer } from 'ws'
import {
  HELLO_TIMEOUT_MS,
  PING_INTERVAL_MS,
  parseBridgeFrame,
  type BridgeFrame,
  type BridgeCaps,
  type ClientFrame,
  type RemoteWireResult,
  type ToolErrorCode,
} from './protocol.ts'
import { verifyToken } from './token.ts'

/**
 * Gateway endpoints the bridge pins to loopback (the rc line's
 * PRIVILEGED_METHODS, restated against the alpha Remote endpoint names:
 * settings/credentials mutation and host-desktop/filesystem actions). The
 * bridge rejects these for non-loopback remotes even with a valid token.
 * Exported so tests can tripwire the list against accidental shrinkage —
 * when the host line adds new privileged endpoints, extend this set in the
 * same commit.
 */
export const PRIVILEGED_METHODS = new Set([
  'settings/describe',
  'settings/openSettingsDocument',
  'settings/openAgentPresetDirectory',
  'settings/update',
  'settings/replace',
  'settings/mutate',
  'credentials/describe',
  'credentials/set',
  'credentials/unset',
  'directoryPicker/pick',
  'directoryPicker/createDirectory',
  'directoryPicker/list',
  'session/openWorkspacePath',
])

/** Session mutations whose WebSocket arrival order is behaviorally significant. */
const ORDERED_SESSION_METHODS = new Set([
  'session/prompt',
  'session/cancel',
])

/** Default cap on one incoming WebSocket message (the ws library default of 100MiB is an unauthenticated DoS surface). */
const DEFAULT_MAX_PAYLOAD_BYTES = 4 * 1024 * 1024

/** Default pump backpressure threshold: pause forwarding when the socket buffer grows past this. */
const DEFAULT_MAX_BUFFERED_BYTES = 4 * 1024 * 1024

/** Default grace period for stream pumps during close(); a wedged gateway iterator must not stall teardown forever. */
const DEFAULT_CLOSE_PUMP_TIMEOUT_MS = 5_000

/** Default pong budget: a connection missing this many consecutive ping cycles is terminated as a zombie. */
const DEFAULT_MISSED_PONGS_ALLOWED = 3

/** Poll cadence while a flooded socket drains. */
const DRAIN_POLL_MS = 50

/** Millisecond delay whose timer never keeps the process alive. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref()
  })
}

/**
 * Race one promise against an abort signal. Resolves `undefined` when the
 * signal wins; the loser's handlers are always attached, so a late rejection
 * cannot surface as an unhandled rejection.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
  if (signal.aborted) return Promise.resolve(undefined)
  return new Promise<T | undefined>((resolve, reject) => {
    const onAbort = (): void => { resolve(undefined) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value) },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error) },
    )
  })
}

/**
 * Extract the session id ordering key from an rpc frame, or undefined when
 * the method does not mutate a specific session (those dispatch freely).
 */
function orderedSessionId(frame: Extract<ClientFrame, { t: 'rpc' }>): string | undefined {
  if (!ORDERED_SESSION_METHODS.has(frame.method)) return undefined
  const request = frame.args.request
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return undefined
  const sessionId = (request as Record<string, unknown>).sessionId
  return typeof sessionId === 'string' ? sessionId : undefined
}

/** Loopback IPv4/IPv6 literals (IPv4-mapped included). Exported for tests and reuse. */
export function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Error thrown by requestTool; the tool registry turns it into an isError result. */
export class BridgeToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeToolError'
  }
}

/** Dependencies the bridge needs from the host. */
export interface BridgeServerDeps {
  /** Bearer token the extension must present in `hello`. */
  token: string
  /**
   * Unary Remote dispatch (slash endpoint + native args), answering the
   * RemoteResult wire form. Plugin-side interceptors (workspace grouping,
   * session deferral) sit on this seam.
   */
  dispatchRpc: (method: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RemoteWireResult>
  /** Open one Remote stream (slash endpoint + native args). */
  openStream: (method: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<AsyncIterable<unknown>>
  /** Default per-tool-call timeout in ms. */
  toolTimeoutMs: number
  /** Capabilities to echo in `hello.ok` (negotiated snapshot budgets). */
  caps: BridgeCaps
  /**
   * Test seam: force the remote address seen by the privilege gate. The
   * sandbox cannot bind arbitrary loopback literals, so the non-loopback
   * branch is exercised through this override; production never sets it.
   */
  remoteAddressOverride?: string
  /** Seconds a fresh socket may present `hello`; defaults to HELLO_TIMEOUT_MS. */
  helloTimeoutMs?: number
  /** Server ping cadence; defaults to PING_INTERVAL_MS. */
  pingIntervalMs?: number
  /** Cap on one incoming message in bytes; defaults to 4MiB. */
  maxPayloadBytes?: number
  /** Pump backpressure threshold (ws bufferedAmount) in bytes; defaults to 4MiB. */
  maxBufferedBytes?: number
  /** Grace period for stream pumps during close(); defaults to 5000. */
  closePumpTimeoutMs?: number
  /** Consecutive missed ping cycles before a zombie connection is terminated; defaults to 3. */
  missedPongsAllowed?: number
}

/** One in-flight tool call awaiting the extension's `tool.result`. */
interface PendingTool {
  resolve: (result: unknown) => void
  reject: (error: BridgeToolError) => void
  timer: NodeJS.Timeout
}

/** One open Remote stream owned by the current connection. */
interface OpenStream {
  abort: AbortController
  pump: Promise<void>
}

/** A socket that passed authentication and owns the single active slot. */
interface ReadyConnection {
  ws: WebSocket
  /** Remote address captured at upgrade time (loopback gate for privileged methods). */
  remoteAddress: string | undefined
  abort: AbortController
  ping: NodeJS.Timeout
  /** Last protocol pong timestamp (ms); refreshed by the client's answer to each ping. */
  lastPong: number
  /** Streams opened by this connection, keyed by the client-minted stream id. */
  streams: Map<string, OpenStream>
}

function sendFrame(ws: WebSocket, frame: BridgeFrame): void {
  /* v8 ignore next -- teardown race: the socket can die between a pump's
  readiness check and this write; the guard refuses writes on dead sockets */
  if (ws.readyState !== WebSocket.OPEN) return
  ws.send(JSON.stringify(frame))
}

/**
 * Decode one ws message payload to text. Exported so all three delivery
 * shapes (fragmented buffer list, Buffer, ArrayBuffer) are unit-testable
 * directly — node ws only ever delivers Buffers in practice.
 * @param data - ws message payload.
 * @returns the decoded UTF-8 text.
 */
export function messageToText(data: Buffer | ArrayBuffer | Buffer[]): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8')
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  return Buffer.from(data).toString('utf8')
}

/**
 * Token-authenticated bridge server. Construct once per plugin instance;
 * dispose with {@link close}.
 */
export class BridgeServer {
  private readonly wss: WebSocketServer
  private current: ReadyConnection | null = null
  private readonly pendingTools = new Map<string, PendingTool>()
  private readonly orderedSessionRpcs = new Map<string, Promise<void>>()
  private closed = false

  constructor(private readonly deps: BridgeServerDeps) {
    // Cap incoming frames: the default 100MiB ws payload limit lets any
    // socket (pre-auth included) force a full JSON.parse of a huge body.
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: this.deps.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    })
  }

  /**
   * Handle one HTTP upgrade for the bridge path.
   * @param req - upgrade request (carries the client's remote address).
   * @param socket - raw socket transferred by the HTTP server.
   * @param head - bytes already read after the upgrade headers.
   */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const remote = this.deps.remoteAddressOverride ?? req.socket.remoteAddress
    const origin = req.headers.origin
    this.wss.handleUpgrade(req, socket, head, (ws) => { this.attach(ws, remote, origin) })
  }

  /**
   * Request one browser action from the connected extension.
   * @param name - tool name (also the wire action name).
   * @param args - validated tool arguments.
   * @param signal - caller cancellation (abort settles the call as cancelled).
   * @param timeoutMs - per-call budget; defaults to the plugin config value.
   * @returns the extension's action result.
   * @throws BridgeToolError when no extension is connected, the call times
   *   out, is cancelled, or the extension reports a failure.
   */
  requestTool(
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
    timeoutMs: number = this.deps.toolTimeoutMs,
    sessionId?: string,
    title?: string,
  ): Promise<unknown> {
    const conn = this.current
    if (conn === null) {
      throw new BridgeToolError('bridge-closed', 'no browser extension is connected to the bridge')
    }
    // A caller that already aborted must not dispatch: the abort listener
    // below does not replay for pre-aborted signals, so the call would be
    // sent to the extension and executed despite the cancellation.
    if (signal.aborted) {
      throw new BridgeToolError('bridge-closed', 'tool call cancelled before dispatch')
    }
    const id = randomUUID()
    const expiresAt = Date.now() + timeoutMs
    return new Promise<unknown>((resolve, reject) => {
      let timer: NodeJS.Timeout
      const settle = (error: BridgeToolError): void => {
        clearTimeout(timer)
        this.pendingTools.delete(id)
        signal.removeEventListener('abort', onAbort)
        reject(error)
      }
      const cancel = (error: BridgeToolError): void => {
        // The extension may still be working on the action after the caller
        // has stopped waiting. Withdraw the call before settling locally so
        // a late completion cannot report success for an expired action.
        sendFrame(conn.ws, { t: 'tool.cancel', id })
        settle(error)
      }
      const onAbort = (): void => {
        cancel(new BridgeToolError('bridge-closed', 'tool call cancelled before the extension answered'))
      }
      timer = setTimeout(() => {
        cancel(new BridgeToolError('timeout', `browser action "${name}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      signal.addEventListener('abort', onAbort, { once: true })
      this.pendingTools.set(id, { resolve, reject, timer })
      const callFrame: BridgeFrame = { t: 'tool.call', id, name, args, expiresAt, ...(sessionId !== undefined ? { sessionId } : {}), ...(title !== undefined ? { title } : {}) }
      conn.ws.send(JSON.stringify(callFrame), (error) => {
        /* v8 ignore next -- teardown race: when the write fails, the socket's
        close handler settles the same call with the same code; the callback
        path is a defensive second settle, covered via the close path */
        if (error != null) {
          settle(new BridgeToolError('bridge-closed', `bridge socket failed before delivery: ${error.message}`))
        }
      })
    })
  }

  /**
   * Terminate the server: close the acceptor, drop all sockets, reject all
   * in-flight tool calls, abort all streams.
   * @returns a promise resolving after the acceptor and all pumps stop.
   */
  async close(): Promise<void> {
    // Idempotent: a second close must not touch the acceptor (ws throws
    // "The server is not running" when closing an already-closed server).
    if (this.closed) return
    this.closed = true
    // Capture the live stream pumps BEFORE replaceConnection clears the map.
    const pumps = this.current === null ? [] : [...this.current.streams.values()].map((stream) => stream.pump)
    this.replaceConnection()
    for (const socket of this.wss.clients) socket.terminate()
    this.current = null
    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => {
        /* v8 ignore next -- acceptor close cannot fail: close() is idempotent
        and the noServer acceptor only reports teardown of already-terminated clients */
        if (error === undefined) resolve()
        /* v8 ignore next -- same unreachable arm */
        else reject(error)
      })
    })
    // Pumps should settle on abort promptly, but a wedged gateway iterator
    // (one that never answers its pending next()) must not stall HMR/unload
    // forever — bound the wait and leave the leak to the host process.
    await Promise.race([
      Promise.allSettled(pumps),
      delay(this.deps.closePumpTimeoutMs ?? DEFAULT_CLOSE_PUMP_TIMEOUT_MS),
    ])
  }

  /** @returns whether an authenticated extension is currently connected. */
  hasConnection(): boolean {
    return this.current !== null
  }

  private attach(ws: WebSocket, remoteAddress: string | undefined, origin: string | undefined): void {
    let helloTimer: NodeJS.Timeout | undefined = setTimeout(() => {
      ws.close(4001, 'hello timeout')
    }, this.deps.helloTimeoutMs ?? HELLO_TIMEOUT_MS)

    const onMessage = (data: Buffer | ArrayBuffer | Buffer[]): void => {
      const text = messageToText(data)
      const frame = parseBridgeFrame(text)
      if (frame === undefined) {
        ws.close(1008, 'unparseable frame')
        return
      }
      if (helloTimer !== undefined) {
        // Pending state: only `hello` is legal.
        if (frame.t !== 'hello') {
          ws.close(1008, 'hello first')
          return
        }
        // Zero-config local mode: loopback sockets skip the token (the
        // extension auto-discovers the bridge and connects without setup).
        // WebSockets have no same-origin policy, so a malicious page could
        // open a cross-origin socket to 127.0.0.1 with a loopback remote —
        // the loopback shortcut therefore requires a chrome-extension://
        // Origin (only extension contexts can present one; pages cannot
        // forge the header). Firefox moz-extension:// origins contain a
        // per-install UUID rather than the manifest's stable Gecko ID, so
        // they are not an identity boundary and must present the bearer token.
        // Non-loopback remotes must also present the bearer token.
        const loopbackNoToken = isLoopbackAddress(remoteAddress)
          && typeof origin === 'string'
          && origin.startsWith('chrome-extension://')
        if (!loopbackNoToken && !verifyToken(this.deps.token, frame.token)) {
          ws.close(4002, 'bad token')
          return
        }
        clearTimeout(helloTimer)
        helloTimer = undefined
        this.promote(ws, remoteAddress)
        return
      }
      this.handleReadyFrame(frame)
    }
    const onClose = (): void => {
      if (helloTimer !== undefined) clearTimeout(helloTimer)
      if (this.current !== null && this.current.ws === ws) this.replaceConnection()
    }
    ws.on('message', onMessage)
    ws.once('close', onClose)
    ws.once('error', onClose)
  }

  /** Promote an authenticated socket to the single active slot. */
  private promote(ws: WebSocket, remoteAddress: string | undefined): void {
    this.replaceConnection()
    const abort = new AbortController()
    const intervalMs = this.deps.pingIntervalMs ?? PING_INTERVAL_MS
    const allowed = this.deps.missedPongsAllowed ?? DEFAULT_MISSED_PONGS_ALLOWED
    const conn: ReadyConnection = { ws, remoteAddress, abort, ping: undefined as unknown as NodeJS.Timeout, lastPong: Date.now(), streams: new Map() }
    const ping = setInterval(() => {
      // Zombie guard: a client whose event loop is wedged keeps the TCP
      // socket open but never answers pings; terminate it so a healthy
      // reconnect can take the single active slot.
      if (Date.now() - conn.lastPong > allowed * intervalMs) {
        ws.terminate()
        return
      }
      sendFrame(ws, { t: 'ping' })
    }, intervalMs)
    conn.ping = ping
    this.current = conn
    sendFrame(ws, { t: 'hello.ok', caps: this.deps.caps })
    ws.once('close', () => {
      clearInterval(ping)
      abort.abort()
    })
  }

  private handleReadyFrame(frame: BridgeFrame): void {
    switch (frame.t) {
      case 'rpc':
        this.routeRpc(frame)
        break
      case 'stream.open':
        this.openStream(frame)
        break
      case 'stream.close':
        this.closeStream(frame.id)
        break
      case 'tool.result':
        this.settleTool(frame.id, frame.ok, frame.ok ? frame.result : frame.error)
        break
      case 'pong': {
        // Liveness bookkeeping for the zombie-connection guard in promote().
        const conn = this.current
        if (conn !== null) conn.lastPong = Date.now()
        break
      }
      case 'hello':
      case 'hello.ok':
      case 'rpc.result':
      case 'stream.frame':
      case 'stream.error':
      case 'tool.call':
      case 'ping':
      case 'error':
        // Protocol violations and unsolicited server-side shapes are ignored;
        // the extension is the only sender on this channel.
        break
    }
  }

  /**
   * Preserve prompt/cancel arrival order per session. In particular, the
   * first prompt may still be materializing a provisional session; its cancel
   * must not reach the gateway until that admission has completed.
   */
  private routeRpc(frame: Extract<ClientFrame, { t: 'rpc' }>): void {
    const sessionId = orderedSessionId(frame)
    if (sessionId === undefined) {
      void this.handleRpc(frame)
      return
    }
    const previous = this.orderedSessionRpcs.get(sessionId) ?? Promise.resolve()
    const task = previous.then(
      () => this.handleRpc(frame),
      () => this.handleRpc(frame),
    )
    this.orderedSessionRpcs.set(sessionId, task)
    const clear = (): void => {
      if (this.orderedSessionRpcs.get(sessionId) === task) this.orderedSessionRpcs.delete(sessionId)
    }
    void task.then(clear, clear)
  }

  /** Whether the connection owning this frame may call the endpoint at all. */
  private forbidden(method: string): boolean {
    const conn = this.current
    return conn !== null && PRIVILEGED_METHODS.has(method) && !isLoopbackAddress(conn.remoteAddress)
  }

  private async handleRpc(frame: Extract<ClientFrame, { t: 'rpc' }>): Promise<void> {
    const conn = this.current
    /* v8 ignore next -- replacement race: a frame can land between a socket
    replacement and the next promotion; the re-check keeps the handler total */
    if (conn === null) return
    if (this.forbidden(frame.method)) {
      sendFrame(conn.ws, { t: 'rpc.result', id: frame.id, ok: false, error: { code: 'forbidden', message: 'method is loopback-only' } })
      return
    }
    try {
      const result = await this.deps.dispatchRpc(frame.method, frame.args, conn.abort.signal)
      if (result.ok) {
        sendFrame(conn.ws, { t: 'rpc.result', id: frame.id, ok: true, value: result.value })
      } else {
        sendFrame(conn.ws, { t: 'rpc.result', id: frame.id, ok: false, error: result.error })
      }
    } catch (error: unknown) {
      sendFrame(conn.ws, { t: 'rpc.result', id: frame.id, ok: false, error: { code: 'internal', message: String(error) } })
    }
  }

  /** Open one Remote stream and pump its frames until closed, failed, or replaced. */
  private openStream(frame: Extract<ClientFrame, { t: 'stream.open' }>): void {
    const conn = this.current
    if (conn === null) return
    if (this.forbidden(frame.method)) {
      sendFrame(conn.ws, { t: 'stream.error', id: frame.id, message: 'method is loopback-only' })
      return
    }
    // A repeated stream id replaces the old subscription (protocol violation,
    // but closing beats leaking).
    this.closeStream(frame.id)
    const ws = conn.ws
    const abort = new AbortController()
    conn.abort.signal.addEventListener('abort', () => { abort.abort() }, { once: true })
    let pump!: Promise<void>
    pump = (async () => {
      let iterator: AsyncIterator<unknown> | undefined
      try {
        const iterable = await this.deps.openStream(frame.method, frame.args, abort.signal)
        iterator = iterable[Symbol.asyncIterator]()
        for (;;) {
          // Race every next() against abort: an idle follow stream can sit in
          // next() for hours, and abort-as-advice alone would leave the pump
          // (and close()) hanging until the gateway feels like answering.
          const next = await raceAbort(iterator.next(), abort.signal)
          if (next === undefined || next.done === true) break
          if (ws.readyState !== WebSocket.OPEN) break
          if (!await this.waitForDrain(ws, abort.signal)) break
          sendFrame(ws, { t: 'stream.frame', id: frame.id, frame: next.value })
        }
      } catch (error: unknown) {
        if (!abort.signal.aborted && ws.readyState === WebSocket.OPEN) {
          sendFrame(ws, { t: 'stream.error', id: frame.id, message: String(error) })
        }
      } finally {
        // Withdraw the subscription explicitly: for-await's implicit return()
        // never runs when we broke out of the raw-iterator loop above, and a
        // gateway iterator left open keeps the follow registration alive.
        if (iterator !== undefined) {
          try { await iterator.return?.() } catch { /* teardown best effort */ }
        }
        const current = this.current
        if (current !== null && current.streams.get(frame.id)?.pump === pump) {
          current.streams.delete(frame.id)
        }
      }
    })()
    conn.streams.set(frame.id, { abort, pump })
  }

  /**
   * Backpressure gate for stream pumps. Returns false when the wait ended
   * because the socket died or the pump was aborted (the caller then stops).
   */
  private async waitForDrain(ws: WebSocket, signal: AbortSignal): Promise<boolean> {
    const limit = this.deps.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES
    for (;;) {
      if (signal.aborted || ws.readyState !== WebSocket.OPEN) return false
      if (ws.bufferedAmount <= limit) return true
      // ws exposes no 'drain' event; poll on a short cadence instead.
      const elapsed = await raceAbort(delay(DRAIN_POLL_MS), signal)
      if (elapsed === undefined) return false
    }
  }

  /** Abort one open stream (client `stream.close`). */
  private closeStream(id: string): void {
    const conn = this.current
    if (conn === null) return
    const stream = conn.streams.get(id)
    if (stream === undefined) return
    conn.streams.delete(id)
    stream.abort.abort()
  }

  private settleTool(id: string, ok: boolean, payload: unknown): void {
    const pending = this.pendingTools.get(id)
    if (pending === undefined) return
    clearTimeout(pending.timer)
    this.pendingTools.delete(id)
    if (ok) pending.resolve(payload)
    else pending.reject(new BridgeToolError(payloadCode(payload), payloadMessage(payload)))
  }

  /** Close the current connection (if any) and settle its in-flight calls and streams. */
  private replaceConnection(): void {
    const conn = this.current
    if (conn === null) return
    this.current = null
    clearInterval(conn.ping)
    conn.abort.abort()
    for (const stream of conn.streams.values()) stream.abort.abort()
    conn.streams.clear()
    if (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING) {
      conn.ws.close(4000, 'replaced')
    }
    for (const [id, pending] of this.pendingTools) {
      clearTimeout(pending.timer)
      this.pendingTools.delete(id)
      pending.reject(new BridgeToolError('bridge-closed', 'the extension connection was replaced'))
    }
  }
}

/**
 * Tool error payload → stable code. The wire parser enforces string fields,
 * so the fallback branches are parser-gated; exported so the fallback
 * contract is unit-testable directly.
 * @param payload - extension-reported error payload.
 * @returns the stable error code.
 */
export function payloadCode(payload: unknown): ToolErrorCode {
  if (typeof payload === 'object' && payload !== null) {
    const code = (payload as { code?: unknown }).code
    if (typeof code === 'string') return code as ToolErrorCode
    return 'internal'
  }
  return 'internal'
}

/**
 * Tool error payload → message. The wire parser enforces string fields, so
 * the fallback branches are parser-gated; exported so the fallback contract
 * is unit-testable directly.
 * @param payload - extension-reported error payload.
 * @returns the human-readable message.
 */
export function payloadMessage(payload: unknown): string {
  if (typeof payload === 'object' && payload !== null) {
    const message = (payload as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
    return 'browser action failed'
  }
  return 'browser action failed'
}
