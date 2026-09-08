/**
 * Typert Remote RPC client: maps `rpc`/`rpc.result` frames to promises keyed
 * by correlation id, with a 30s timeout. One instance per bridge generation.
 *
 * The wire dialect is alpha-native: slash-joined endpoint names, the Remote
 * descriptor's `args` object, and the flattened RemoteResult (`value` /
 * `error`) on `rpc.result`.
 *
 * @module
 */

import type { BridgeClient } from './bridge.ts'
import type { ServerFrame } from 'dsh-browser-firefox/src/protocol.ts'

const RPC_TIMEOUT_MS = 30_000

interface PendingRpc {
  resolve(result: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

/**
 * Create an RPC facade over a live bridge. Wraps the bridge's frame sink so
 * other handlers keep working; settles `rpc.result` frames by correlation id.
 * @param bridge - the bridge client (must be connected).
 * @returns `{ request }` where request dispatches one unary Remote call.
 */
export function createRpc(bridge: BridgeClient): { request(method: string, args: Record<string, unknown>): Promise<unknown> } {
  const pending = new Map<string, PendingRpc>()

  const previous = bridge.sinks.onFrame
  bridge.sinks.onFrame = (frame: ServerFrame) => {
    previous?.(frame)
    if (frame.t !== 'rpc.result') return
    const entry = pending.get(frame.id)
    if (entry === undefined) return
    pending.delete(frame.id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.value)
    else entry.reject(new Error(`${frame.error.code}: ${frame.error.message}`))
  }

  return {
    request(method: string, args: Record<string, unknown>): Promise<unknown> {
      if (!bridge.connected) {
        return Promise.reject(new Error('bridge not connected'))
      }
      const id = crypto.randomUUID()
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`remote rpc ${method} timed out after ${RPC_TIMEOUT_MS}ms`))
        }, RPC_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        const sent = bridge.send({ t: 'rpc', id, method, args })
        if (!sent) {
          pending.delete(id)
          clearTimeout(timer)
          reject(new Error('bridge socket closed before request dispatch'))
        }
      })
    },
  }
}
