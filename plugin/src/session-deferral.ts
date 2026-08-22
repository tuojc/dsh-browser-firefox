/**
 * Defer real session creation until the first prompt.
 *
 * The panel calls `session.create` as soon as it connects, but a session that
 * is opened and never used should leave zero trace in the store/GUI. This
 * wrapper answers `session.create` with a provisional id (minted locally,
 * nothing persisted), serves `session.history` for provisional ids as empty,
 * and materializes the real session — same id, original create payload — on
 * the first `session.prompt` for that id. Abandoned provisional ids are
 * pruned after {@link PROVISIONAL_TTL_MS}.
 *
 * @module @deepseek-ai/dsh-bridge-browser/src/session-deferral
 */

import { randomUUID } from 'node:crypto'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Provisional entries older than this are dropped on the next create. */
const PROVISIONAL_TTL_MS = 30 * 60_000

type CreateRequest = Parameters<ApiProxy['sessions']['create']>[0]
type HistoryRequest = Parameters<ApiProxy['sessions']['history']>[0]
type PromptRequest = Parameters<ApiProxy['sessions']['prompt']>[0]

interface ProvisionalEntry {
  /** The original create payload, replayed at materialization (keeps cwd/workspaceId). */
  payload: CreateRequest['payload']
  createdAt: number
}

/**
 * Wrap the gateway sessions API so `session.create` returns a provisional id
 * without creating anything; the real session materializes on the first
 * `session.prompt` for that id.
 *
 * @param api - Gateway API implementation.
 * @param enabled - Whether deferral is active; false returns the API untouched.
 * @returns the original API when disabled, otherwise the wrapped API.
 */
export function withSessionDeferral(api: ApiProxy, enabled: boolean): ApiProxy {
  if (!enabled) return api

  const provisional = new Map<SessionId, ProvisionalEntry>()
  const materializing = new Map<SessionId, ReturnType<ApiProxy['sessions']['create']>>()

  const prune = (): void => {
    const cutoff = Date.now() - PROVISIONAL_TTL_MS
    for (const [id, entry] of provisional) {
      if (entry.createdAt < cutoff) provisional.delete(id)
    }
  }

  const mintedId = (payload: CreateRequest['payload']): SessionId =>
    payload.sessionId ?? `session-${randomUUID()}` as SessionId

  return {
    ...api,
    sessions: {
      ...api.sessions,
      async create(request: CreateRequest) {
        prune()
        const sessionId = mintedId(request.payload)
        provisional.set(sessionId, { payload: { ...request.payload }, createdAt: Date.now() })
        return { rpcId: request.rpcId, result: { ok: true, value: { sessionId } } }
      },
      async history(request: HistoryRequest) {
        if (!provisional.has(request.payload.sessionId)) return api.sessions.history(request)
        return { rpcId: request.rpcId, result: { ok: true, value: { events: [], hasMore: false } } }
      },
      async prompt(request: PromptRequest) {
        const entry = provisional.get(request.payload.sessionId)
        if (entry === undefined) return api.sessions.prompt(request)
        const existing = materializing.get(request.payload.sessionId)
        const pending = existing ?? api.sessions.create({
          rpcId: RpcId(randomUUID()),
          payload: { ...entry.payload, sessionId: request.payload.sessionId },
        })
        if (existing === undefined) {
          materializing.set(request.payload.sessionId, pending)
          void pending.then(
            () => { materializing.delete(request.payload.sessionId) },
            () => { materializing.delete(request.payload.sessionId) },
          )
        }
        const created = await pending
        if (!created.result.ok) {
          // The create failure value shape differs from prompt's success
          // shape; the carrier relays only result.ok/error, so the value
          // side is irrelevant here.
          return created as unknown as Awaited<ReturnType<ApiProxy['sessions']['prompt']>>
        }
        provisional.delete(request.payload.sessionId)
        return api.sessions.prompt(request)
      },
    },
  }
}
