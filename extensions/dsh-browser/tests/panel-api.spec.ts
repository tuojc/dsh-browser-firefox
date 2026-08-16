// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectPanel } from '../src/panel/api.ts'
import { isApprovalDecision, type ApprovalRequest } from '../src/security/approval.ts'
import type { TabAffinityState } from '../src/background/tab-affinity.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('panel approval protocol', () => {
  it('accepts session trust while retaining the previous permanent-trust wire value', () => {
    expect(isApprovalDecision('always-allow-reads')).toBe(true)
    expect(isApprovalDecision('trust-session')).toBe(true)
    expect(isApprovalDecision('trust-origin')).toBe(true)
    expect(isApprovalDecision('trust-forever')).toBe(false)
  })

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
    api.respondToApproval(request.id, 'trust-session')

    expect(requestListener).toHaveBeenCalledWith(request)
    expect(resolvedListener).toHaveBeenCalledWith(request.id)
    expect(postMessage).toHaveBeenCalledWith({
      type: 'approval.response',
      id: request.id,
      decision: 'trust-session',
    })
  })

  it('delivers tab-affinity state and sends revision-bound handoff choices', () => {
    let receive: ((message: unknown) => void) | undefined
    const postMessage = vi.fn()
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { receive = listener }) },
      onDisconnect: { addListener: vi.fn() },
    }
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } })
    const api = connectPanel()
    const listener = vi.fn()
    api.onTabAffinity(listener)
    const state: TabAffinityState = {
      revision: 4,
      status: 'handoff',
      controlled: { tabId: 1, windowId: 2, title: 'Original', url: 'https://original.example/' },
      active: { tabId: 3, windowId: 2, title: 'Current', url: 'https://current.example/' },
    }

    receive?.({ type: 'tab-affinity', state })
    api.resolveTabAffinity(state.revision, 'follow', 'session-1')

    expect(listener).toHaveBeenCalledWith(state)
    expect(postMessage).toHaveBeenCalledWith({
      type: 'tab-affinity.response',
      revision: 4,
      decision: 'follow',
      sessionId: 'session-1',
    })
  })

  it('delivers a resume hint and records the panel session', () => {
    let receive: ((message: unknown) => void) | undefined
    const postMessage = vi.fn()
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { receive = listener }) },
      onDisconnect: { addListener: vi.fn() },
    }
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } })
    const api = connectPanel()
    const listener = vi.fn()
    api.onSessionResumeHint(listener)

    receive?.({ type: 'session.resume-hint', sessionId: 'session-recent' })
    api.setActiveSession('session-current')

    expect(listener).toHaveBeenCalledWith('session-recent')
    expect(postMessage).toHaveBeenCalledWith({ type: 'session.active', sessionId: 'session-current' })
  })

  it('correlates host-interaction answers with globally unique response ids', async () => {
    let receive: ((message: unknown) => void) | undefined
    const postMessage = vi.fn()
    const port = {
      postMessage,
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { receive = listener }) },
      onDisconnect: { addListener: vi.fn() },
    }
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abc')
    const api = connectPanel()

    const pending = api.respond('question-rpc', {
      ok: true,
      value: { sessionId: 'session-1', answer: { answers: [] } },
    })
    expect(postMessage).toHaveBeenCalledWith({
      type: 'respond',
      id: '12345678-1234-4234-8234-123456789abc',
      rpcId: 'question-rpc',
      result: { ok: true, value: { sessionId: 'session-1', answer: { answers: [] } } },
    })
    receive?.({
      type: 'respond.result',
      id: '12345678-1234-4234-8234-123456789abc',
      ok: true,
      result: { accepted: true },
    })
    await expect(pending).resolves.toEqual({ accepted: true })
  })

  it('rejects a pending host-interaction answer when its receipt reports failure', async () => {
    let receive: ((message: unknown) => void) | undefined
    const port = {
      postMessage: vi.fn(),
      onMessage: { addListener: vi.fn((listener: (message: unknown) => void) => { receive = listener }) },
      onDisconnect: { addListener: vi.fn() },
    }
    vi.stubGlobal('chrome', { runtime: { connect: vi.fn(() => port) } })
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('12345678-1234-4234-8234-123456789abd')
    const api = connectPanel()
    const pending = api.respond('question-rpc', { ok: false, error: { code: 'cancelled', message: 'closed', details: {} } })
    receive?.({
      type: 'respond.result',
      id: '12345678-1234-4234-8234-123456789abd',
      ok: false,
      error: { code: 'bridge-disconnected', message: 'connection lost' },
    })
    await expect(pending).rejects.toThrow('connection lost')
  })
})
