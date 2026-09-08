import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteWireResult } from '../src/protocol.ts'
import { withSessionDeferral } from '../src/session-deferral.ts'
import type { RpcDispatch } from '../src/session-workspace.ts'

type DispatchMock = ReturnType<typeof vi.fn> & RpcDispatch

const SIGNAL = new AbortController().signal

function dispatchHarness() {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  const dispatch = vi.fn(async (method: string, args: Record<string, unknown>): Promise<RemoteWireResult> => {
    calls.push({ method, args })
    if (method === 'session/create') {
      return { ok: true, value: { sessionId: (args.request as { sessionId?: string }).sessionId } }
    }
    if (method === 'session/prompt') return { ok: true, value: { accepted: true } }
    return { ok: true, value: null }
  }) as DispatchMock
  return { dispatch, calls }
}

const PROMPT_ARGS = (sessionId: string): Record<string, unknown> => ({
  request: { sessionId, requestId: 'req-1', mode: 'queue', content: [] },
})

async function provisionalId(wrapped: RpcDispatch): Promise<string> {
  const result = await wrapped('session/create', { request: {} }, SIGNAL)
  if (!result.ok) throw new Error('unreachable: provisional create must succeed')
  return (result.value as { sessionId: string }).sessionId
}

describe('withSessionDeferral', () => {
  afterEach(() => { vi.useRealTimers() })

  it('answers create with a provisional id without touching the gateway', async () => {
    const { dispatch, calls } = dispatchHarness()
    const wrapped = withSessionDeferral(dispatch, true)

    const id = await provisionalId(wrapped)

    expect(id).toMatch(/^session-/)
    expect(calls).toEqual([])
  })

  it('honors an explicit session id from the caller', async () => {
    const { dispatch } = dispatchHarness()
    const wrapped = withSessionDeferral(dispatch, true)

    const result = await wrapped('session/create', { request: { sessionId: 'session-fixed' } }, SIGNAL)

    expect(result).toEqual({ ok: true, value: { sessionId: 'session-fixed' } })
  })

  it('materializes the session on the first prompt, replaying the create request', async () => {
    const { dispatch, calls } = dispatchHarness()
    const wrapped = withSessionDeferral(dispatch, true)
    const created = await wrapped('session/create', { request: { cwd: '/work' } }, SIGNAL)
    if (!created.ok) throw new Error('unreachable: provisional create must succeed')
    const id = (created.value as { sessionId: string }).sessionId

    await wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)

    expect(calls[0]).toMatchObject({ method: 'session/create', args: { request: { cwd: '/work', sessionId: id } } })
    expect(calls[1]).toEqual({ method: 'session/prompt', args: PROMPT_ARGS(id) })
  })

  it('passes prompts for unknown sessions through untouched', async () => {
    const { dispatch, calls } = dispatchHarness()
    const wrapped = withSessionDeferral(dispatch, true)

    await wrapped('session/prompt', PROMPT_ARGS('session-existing'), SIGNAL)

    expect(calls).toEqual([{ method: 'session/prompt', args: PROMPT_ARGS('session-existing') }])
  })

  it('deduplicates concurrent prompts into one materialization', async () => {
    const methods: string[] = []
    let release!: () => void
    const dispatch = vi.fn(async (method: string, args: Record<string, unknown>): Promise<RemoteWireResult> => {
      methods.push(method)
      if (method === 'session/create') {
        await new Promise<void>((resolve) => { release = resolve })
        return { ok: true, value: { sessionId: (args.request as { sessionId?: string }).sessionId } }
      }
      return { ok: true, value: { accepted: true } }
    }) as DispatchMock
    const wrapped = withSessionDeferral(dispatch, true)
    const id = await provisionalId(wrapped)

    const first = wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)
    const second = wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)
    release()
    await Promise.all([first, second])

    expect(methods.filter((method) => method === 'session/create')).toHaveLength(1)
    expect(methods.filter((method) => method === 'session/prompt')).toHaveLength(2)
  })

  it('propagates a materialization failure without forwarding the prompt, and retries later', async () => {
    let creates = 0
    const dispatch = vi.fn(async (method: string): Promise<RemoteWireResult> => {
      if (method === 'session/create') {
        creates += 1
        if (creates === 1) {
          return { ok: false, error: { code: 'internal', message: 'boom', details: {} } }
        }
        return { ok: true, value: { sessionId: 'session-x' } }
      }
      return { ok: true, value: { accepted: true } }
    }) as DispatchMock
    const wrapped = withSessionDeferral(dispatch, true)
    const id = await provisionalId(wrapped)

    const failed = await wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)
    expect(failed).toEqual({
      ok: false,
      error: { code: 'internal', message: 'boom', details: {} },
    })
    expect(dispatch.mock.calls.filter((call) => call[0] === 'session/prompt')).toHaveLength(0)

    // The entry survives the failure: a later prompt retries materialization.
    await wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)
    expect(creates).toBe(2)
    expect(dispatch.mock.calls.filter((call) => call[0] === 'session/prompt')).toHaveLength(1)
  })

  it('propagates a thrown materialization failure and keeps the entry for retry', async () => {
    let creates = 0
    const dispatch = vi.fn(async (method: string): Promise<RemoteWireResult> => {
      if (method === 'session/create') {
        creates += 1
        if (creates === 1) throw new Error('create exploded')
        return { ok: true, value: { sessionId: 'session-x' } }
      }
      return { ok: true, value: { accepted: true } }
    }) as DispatchMock
    const wrapped = withSessionDeferral(dispatch, true)
    const id = await provisionalId(wrapped)

    await expect(wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)).rejects.toThrow('create exploded')
    expect(dispatch.mock.calls.filter((call) => call[0] === 'session/prompt')).toHaveLength(0)

    // The cleanup ran: a later prompt retries materialization.
    await wrapped('session/prompt', PROMPT_ARGS(id), SIGNAL)
    expect(creates).toBe(2)
    expect(dispatch.mock.calls.filter((call) => call[0] === 'session/prompt')).toHaveLength(1)
  })

  it('prunes stale provisional entries on the next create', async () => {
    vi.useFakeTimers()
    const { dispatch, calls } = dispatchHarness()
    const wrapped = withSessionDeferral(dispatch, true)
    const first = await provisionalId(wrapped)

    vi.advanceTimersByTime(31 * 60_000)
    const second = await provisionalId(wrapped)

    // The stale id now reaches the gateway on prompt; the fresh id is still provisional.
    await wrapped('session/prompt', PROMPT_ARGS(first), SIGNAL)
    expect(calls.filter((call) => call.method === 'session/prompt')).toHaveLength(1)
    const fresh = await wrapped('session/prompt', PROMPT_ARGS(second), SIGNAL)
    expect(fresh).toEqual({ ok: true, value: { accepted: true } })
    // The fresh prompt materialized first, so the gateway saw create then prompt.
    expect(calls.filter((call) => call.method === 'session/create')).toHaveLength(1)
  })

  it('returns the original dispatch when disabled', () => {
    const { dispatch } = dispatchHarness()

    expect(withSessionDeferral(dispatch, false)).toBe(dispatch)
  })
})
