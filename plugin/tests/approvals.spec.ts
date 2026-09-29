import { describe, expect, it, vi } from 'vitest'
import { ApprovalBridge, asApprovalDecisionArgs } from '../src/approvals.ts'
import type { ServerFrame } from '../src/protocol.ts'

function harness(): { bridge: ApprovalBridge; frames: ServerFrame[] } {
  const frames: ServerFrame[] = []
  const bridge = new ApprovalBridge({ push: (frame) => { frames.push(frame) } })
  return { bridge, frames }
}

describe('asApprovalDecisionArgs', () => {
  it('accepts the closed decision set only', () => {
    expect(asApprovalDecisionArgs({ approvalId: 'a', sessionId: 's', decision: 'allowed-once' }))
      .toEqual({ approvalId: 'a', sessionId: 's', decision: 'allowed-once' })
    expect(asApprovalDecisionArgs({ approvalId: 'a', sessionId: 's', decision: 'rejected' }))
      .toEqual({ approvalId: 'a', sessionId: 's', decision: 'rejected' })
    expect(asApprovalDecisionArgs({ approvalId: 'a', sessionId: 's', decision: 'always' })).toBeUndefined()
    expect(asApprovalDecisionArgs({ approvalId: 'a', sessionId: 's' })).toBeUndefined()
    expect(asApprovalDecisionArgs({ approvalId: 'a', decision: 'rejected' })).toBeUndefined()
    expect(asApprovalDecisionArgs('nope')).toBeUndefined()
  })
})

describe('ApprovalBridge', () => {
  it('pushes the request and resolves with the sidebar decision', async () => {
    const { bridge, frames } = harness()
    const pending = bridge.ask('s1', { toolName: 'bash', callId: 'c1', reason: '写入工作区外' }, async () => 'unavailable')
    expect(frames).toHaveLength(1)
    const frame = frames[0]
    expect(frame).toMatchObject({ t: 'approval.requested', sessionId: 's1', toolName: 'bash', callId: 'c1', reason: '写入工作区外' })
    const approvalId = (frame as Extract<ServerFrame, { t: 'approval.requested' }>).id
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'allowed-once' })).toEqual({ accepted: true })
    await expect(pending).resolves.toBe('allowed-once')
  })

  it('omits optional fields the host did not supply', () => {
    const { bridge, frames } = harness()
    void bridge.ask('s1', { toolName: 'browser_click' }, async () => 'unavailable')
    expect(frames[0]).toEqual({ t: 'approval.requested', id: expect.any(String), sessionId: 's1', toolName: 'browser_click' })
  })

  it('rejects decisions for unknown ids, foreign sessions and settled requests', async () => {
    const { bridge, frames } = harness()
    const pending = bridge.ask('s1', { toolName: 'bash' }, async () => 'unavailable')
    const approvalId = (frames[0] as Extract<ServerFrame, { t: 'approval.requested' }>).id
    expect(bridge.decide({ approvalId: 'other', sessionId: 's1', decision: 'rejected' })).toEqual({ accepted: false, reason: 'not-pending' })
    expect(bridge.decide({ approvalId, sessionId: 's2', decision: 'rejected' })).toEqual({ accepted: false, reason: 'not-pending' })
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'rejected' })).toEqual({ accepted: true })
    await expect(pending).resolves.toBe('rejected')
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'allowed-once' })).toEqual({ accepted: false, reason: 'not-pending' })
  })

  it('refuses a decision outside the closed set', () => {
    const { bridge, frames } = harness()
    void bridge.ask('s1', { toolName: 'bash' }, async () => 'unavailable')
    const approvalId = (frames[0] as Extract<ServerFrame, { t: 'approval.requested' }>).id
    // 直接调用（绕过 args 解析）也要拒绝非法决策。
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'always-allow' as never }))
      .toEqual({ accepted: false, reason: 'bad-decision' })
  })

  it('withdraws the card and answers cancelled when the host aborts', async () => {
    const { bridge, frames } = harness()
    const controller = new AbortController()
    const pending = bridge.ask('s1', { toolName: 'bash' }, async () => 'unavailable', controller.signal)
    controller.abort()
    await expect(pending).resolves.toBe('cancelled')
    expect(frames[1]).toMatchObject({ t: 'approval.resolved', sessionId: 's1' })
    const approvalId = (frames[0] as Extract<ServerFrame, { t: 'approval.requested' }>).id
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'rejected' })).toEqual({ accepted: false, reason: 'not-pending' })
  })

  it('short-circuits an already-aborted signal without pushing a card', async () => {
    const { bridge, frames } = harness()
    const controller = new AbortController()
    controller.abort()
    await expect(bridge.ask('s1', { toolName: 'bash' }, async () => 'unavailable', controller.signal)).resolves.toBe('cancelled')
    expect(frames).toHaveLength(0)
  })

  it('delegates every unsettled approval when the bridge drops', async () => {
    const { bridge } = harness()
    const next = vi.fn(async () => 'rejected' as const)
    const pending = bridge.ask('s1', { toolName: 'bash' }, next)
    bridge.delegateAll()
    await expect(pending).resolves.toBe('rejected')
    expect(next).toHaveBeenCalledOnce()
  })

  it('answers unavailable on unload so no tool call outlives the plugin', async () => {
    const { bridge } = harness()
    const pending = bridge.ask('s1', { toolName: 'bash' }, async () => 'rejected')
    bridge.dispose()
    await expect(pending).resolves.toBe('unavailable')
  })
})

describe('PendingWaterfalls（共享结算簿记）', () => {
  it('settle 只生效一次，后续调用与 unknown id 都是 no-op', async () => {
    const { bridge, frames } = harness()
    const pending = bridge.ask('s1', { toolName: 'bash' }, async () => 'unavailable')
    const approvalId = (frames[0] as Extract<ServerFrame, { t: 'approval.requested' }>).id
    expect(bridge.decide({ approvalId: 'unknown', sessionId: 's1', decision: 'rejected' }))
      .toEqual({ accepted: false, reason: 'not-pending' })
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'rejected' })).toEqual({ accepted: true })
    expect(bridge.decide({ approvalId, sessionId: 's1', decision: 'allowed-once' }))
      .toEqual({ accepted: false, reason: 'not-pending' })
    bridge.delegateAll()
    bridge.dispose()
    await expect(pending).resolves.toBe('rejected')
  })
})
