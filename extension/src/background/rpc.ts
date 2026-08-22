/**
 * Gateway RPC client: maps `rpc`/`rpc.result` frames to promises keyed by
 * correlation id, with a 30s timeout. One instance per bridge generation.
 *
 * @module
 */

import type { BridgeClient } from './bridge.ts'
import type { ServerFrame } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'

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
 * @returns `{ request }` where request dispatches one unary gateway RPC.
 */
export function createRpc(bridge: BridgeClient): { request(method: string, payload: unknown): Promise<unknown> } {
  const pending = new Map<string, PendingRpc>()

  const previous = bridge.sinks.onFrame
  bridge.sinks.onFrame = (frame: ServerFrame) => {
    previous?.(frame)
    if (frame.t !== 'rpc.result') return
    const entry = pending.get(frame.id)
    if (entry === undefined) return
    pending.delete(frame.id)
    clearTimeout(entry.timer)
    if (frame.ok) entry.resolve(frame.result)
    else entry.reject(new Error(`${frame.error.code}: ${frame.error.message}`))
  }

  return {
    request(method: string, payload: unknown): Promise<unknown> {
      if (!bridge.connected) {
        return Promise.reject(new Error('bridge not connected'))
      }
      const id = crypto.randomUUID()
      return new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`gateway rpc ${method} timed out after ${RPC_TIMEOUT_MS}ms`))
        }, RPC_TIMEOUT_MS)
        pending.set(id, { resolve, reject, timer })
        const sent = bridge.send({ t: 'rpc', id, method, payload })
        if (!sent) {
          pending.delete(id)
          clearTimeout(timer)
          reject(new Error('bridge socket closed before request dispatch'))
        }
      })
    },
  }
}
