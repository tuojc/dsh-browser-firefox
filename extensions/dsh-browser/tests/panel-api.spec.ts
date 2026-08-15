// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectPanel } from '../src/panel/api.ts'
import type { ApprovalRequest } from '../src/security/approval.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('panel approval protocol', () => {
  it('delivers approval requests, resolution events, and correlated decisions', () => {
    let receive: ((message: unknown) => void) | undefined
    const postMessage = vi.fn()
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { receive = listener }) },
      onDisconnect: { addListener: vi.fn() },
    }
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } })
    const api = connectPanel()
    const requestListener = vi.fn()
    const resolvedListener = vi.fn()
    api.onApprovalRequest(requestListener)
    api.onApprovalResolved(resolvedListener)
    const request: ApprovalRequest = {
      id: 'approval-1',
      kind: 'action',
      action: 'browser_click',
      summary: '点击元素 [3]',
      origins: ['https://example.com'],
      canTrust: true,
    }

    receive?.({ type: 'approval.request', request })
    receive?.({ type: 'approval.resolved', id: request.id })
    api.respondToApproval(request.id, 'allow-once')

    expect(requestListener).toHaveBeenCalledWith(request)
    expect(resolvedListener).toHaveBeenCalledWith(request.id)
    expect(postMessage).toHaveBeenCalledWith({
      type: 'approval.response',
      id: request.id,
      decision: 'allow-once',
    })
  })
})
