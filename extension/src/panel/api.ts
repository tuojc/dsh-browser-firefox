/**
 * Panel ↔ background port client. The panel never touches the bridge or the
 * gateway directly; everything goes through the service worker's port.
 *
 * @module
 */

import type { BridgeCaps } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import type { ServerFrame } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import type { BridgeState } from '../background/bridge.ts'
import type { Settings } from '../background/index.ts'

/** Panel-side subset of the extension settings. */
export type PanelSettings = Settings

interface RpcResultMessage {
  type: 'rpc.result'
  id: string
  ok: boolean
  result?: unknown
  error?: { code: string; message: string }
}

interface StatusMessage {
  type: 'status'
  state: BridgeState
  caps: BridgeCaps | null
}

interface EventMessage {
  type: 'event'
  frame: ServerFrame
}

type BackgroundMessage = RpcResultMessage | StatusMessage | EventMessage

/** The panel API surface. */
export interface PanelApi {
  rpc<T = unknown>(method: string, payload?: unknown): Promise<T>
  onStatus(callback: (state: BridgeState, caps: BridgeCaps | null) => void): () => void
  onEvent(callback: (frame: ServerFrame) => void): () => void
  updateSettings(settings: Partial<PanelSettings>): void
  requestStatus(): void
}

/** Connect to the background service worker and return the panel API. */
export function connectPanel(): PanelApi {
  type Port = ReturnType<typeof browser.runtime.connect>
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  const statusListeners = new Set<(state: BridgeState, caps: BridgeCaps | null) => void>()
  const eventListeners = new Set<(frame: ServerFrame) => void>()

  let port: Port | null = null
  let reconnectPromise: Promise<Port> | null = null

  function connectionError(cause?: unknown): Error {
    return cause instanceof Error ? cause : new Error('background disconnected')
  }

  /** Reject every accepted-but-unanswered call; none are replayed (they may have executed). */
  function failAll(error: Error, preserve?: { kind: 'rpc'; id: string }): void {
    for (const [id, entry] of pending) {
      if (preserve?.kind === 'rpc' && preserve.id === id) continue
      entry.reject(error)
      pending.delete(id)
    }
  }

  function attach(next: Port): Port {
    port = next
    next.onMessage.addListener(onMessage)
    next.onDisconnect.addListener(() => {
      if (port !== next) return
      port = null
      failAll(connectionError())
      // Firefox event pages and extension reloads can invalidate a live Port.
      // Reconnect once while the panel is still open; later sends share the
      // same attempt instead of opening competing ports.
      void ensurePort(150).catch(() => {})
    })
    return next
  }

  function ensurePort(delayMs = 0): Promise<Port> {
    if (port !== null) return Promise.resolve(port)
    if (reconnectPromise !== null) return reconnectPromise
    const attempt = new Promise<void>((resolve) => { setTimeout(resolve, delayMs) })
      .then(() => port ?? attach(browser.runtime.connect({ name: 'dsh-panel' })))
    reconnectPromise = attempt
    void attempt.then(
      () => { if (reconnectPromise === attempt) reconnectPromise = null },
      () => { if (reconnectPromise === attempt) reconnectPromise = null },
    )
    return attempt
  }

  function invalidate(stale: Port, error: Error, preserve?: { kind: 'rpc'; id: string }): void {
    if (port !== stale) return
    port = null
    failAll(error, preserve)
  }

  /**
   * Post once on the live port. Calls made during reconnect wait for the shared
   * replacement; a synchronous stale-port failure retries only the message that
   * is known not to have been accepted. Requests already accepted by the old
   * port are rejected by invalidate()/failAll() and are never replayed.
   */
  function send(message: unknown, preserve?: { kind: 'rpc'; id: string }): Promise<void> {
    const current = port
    if (current !== null) {
      try {
        current.postMessage(message)
        return Promise.resolve()
      } catch (cause) {
        invalidate(current, connectionError(cause), preserve)
      }
    }
    return ensurePort(150).then((next) => {
      try {
        next.postMessage(message)
      } catch (cause) {
        const error = connectionError(cause)
        invalidate(next, error)
        throw error
      }
    })
  }

  function onMessage(message: unknown): void {
    if (typeof message !== 'object' || message === null) return
    const msg = message as BackgroundMessage
    switch (msg.type) {
      case 'rpc.result': {
        const entry = pending.get(msg.id)
        if (entry === undefined) return
        pending.delete(msg.id)
        // The bridge relays the gateway's ServerResponse envelope verbatim
        // ({ type, rpcId, result: { ok, value | error } }); unwrap the value
        // so callers get the business payload, and surface business errors.
        const envelope = msg.result as { result?: { ok?: boolean; value?: unknown; error?: { message?: string } } } | undefined
        const business = envelope?.result
        if (msg.ok && business?.ok !== false) entry.resolve(business?.value)
        else entry.reject(new Error(business?.error?.message ?? msg.error?.message ?? 'rpc failed'))
        break
      }
      case 'status':
        for (const listener of statusListeners) listener(msg.state, msg.caps)
        break
      case 'event':
        for (const listener of eventListeners) listener(msg.frame)
        break
    }
  }

  try {
    attach(browser.runtime.connect({ name: 'dsh-panel' }))
  } catch {
    void ensurePort(150).catch(() => {})
  }

  return {
    rpc<T>(method: string, payload?: unknown): Promise<T> {
      const id = crypto.randomUUID()
      return new Promise<T>((resolve, reject) => {
        const entry = { resolve: (value: unknown) => resolve(value as T), reject }
        pending.set(id, entry)
        void send({ type: 'rpc', id, method, payload }, { kind: 'rpc', id }).catch((error: unknown) => {
          if (pending.get(id) !== entry) return
          pending.delete(id)
          reject(connectionError(error))
        })
      })
    },
    onStatus(callback) {
      statusListeners.add(callback)
      return () => { statusListeners.delete(callback) }
    },
    onEvent(callback) {
      eventListeners.add(callback)
      return () => { eventListeners.delete(callback) }
    },
    updateSettings(next) {
      void send({ type: 'settings', settings: next }).catch(() => {})
    },
    requestStatus() {
      void send({ type: 'request-status' }).catch(() => {})
    },
  }
}
