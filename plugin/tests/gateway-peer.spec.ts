import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createGatewayPeer } from '../src/gateway-peer.ts'

/** Minimal context: the helper only registers one disposal effect. */
function contextWithEffect(): { ctx: Context; cleanups: Array<() => void> } {
  const cleanups: Array<() => void> = []
  const ctx = {
    effect: (register: () => () => void) => {
      cleanups.push(register())
    },
  } as unknown as Context
  return { ctx, cleanups }
}

describe('createGatewayPeer', () => {
  it('is a live owner Peer scoped to the plugin fiber', async () => {
    const { ctx, cleanups } = contextWithEffect()
    const peer = createGatewayPeer(ctx)

    expect(peer.principal).toEqual({ kind: 'owner' })
    expect(peer.interactions).toBe('none')
    expect(peer.id.length).toBeGreaterThan(0)
    expect(peer.signal.aborted).toBe(false)
    expect(cleanups).toHaveLength(1)

    cleanups[0]!()
    expect(peer.signal.aborted).toBe(true)

    // Idempotent: disposing again must not throw or re-abort.
    await peer.dispose()
    expect(peer.signal.aborted).toBe(true)
  })
})
