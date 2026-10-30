/**
 * In-process owner Peer for Typert Remote dispatch.
 *
 * dsh 0.2.1 requires every `typertGateway.invoke` / `stream` request to name a
 * live {@link PeerScope}: the Gateway reads `peer.signal` and `peer.principal`
 * without a fallback, because the 0.2.0 operator-peer default is gone. The
 * bridge mounts its own token-authenticated carrier, so it speaks as the host
 * owner; the Peer lives exactly as long as the plugin fiber.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway/types'

/** The Peer a Gateway request must name (required since dsh 0.2.1). */
export type GatewayPeer = InvokeRemoteRequest['peer']

/**
 * Create the bridge's owner Peer and tie its lifetime to the calling fiber.
 *
 * The returned scope is structurally a full `PeerScope`; the Gateway only
 * needs `id`, `principal`, `signal`, and `interactions` for unary calls and
 * streams, while `ctx` keeps a future event-stream registration fiber-scoped.
 *
 * @param ctx - plugin context whose disposal aborts the peer.
 * @returns a live owner Peer that is aborted when the plugin unloads.
 */
export function createGatewayPeer(ctx: Context): GatewayPeer {
  const lifetime = new AbortController()
  const dispose = async (): Promise<void> => {
    if (!lifetime.signal.aborted) {
      lifetime.abort(new Error('bridge-browser: gateway peer disposed'))
    }
  }
  ctx.effect(() => () => { void dispose() }, 'bridge-browser: gateway peer')
  return {
    id: randomUUID() as GatewayPeer['id'],
    ctx,
    principal: { kind: 'owner' },
    signal: lifetime.signal,
    interactions: 'none',
    dispose,
  }
}
