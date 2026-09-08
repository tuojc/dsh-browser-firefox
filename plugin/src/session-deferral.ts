/**
 * Defer real session creation until the first prompt.
 *
 * The panel calls `session/create` as soon as it connects, but a session that
 * is opened and never used should leave zero trace in the store/GUI. This
 * interceptor answers `session/create` with a provisional id (minted locally,
 * nothing persisted) and materializes the real session — same id, original
 * create request — on the first `session/prompt` for that id. Abandoned
 * provisional ids are pruned after {@link PROVISIONAL_TTL_MS}.
 *
 * @module @deepseek-ai/dsh-bridge-browser/src/session-deferral
 */

import { randomUUID } from 'node:crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { RemoteWireResult } from './protocol.ts'
import type { RpcDispatch } from './session-workspace.ts'

/** Provisional entries older than this are dropped on the next create. */
const PROVISIONAL_TTL_MS = 30 * 60_000

interface ProvisionalEntry {
  /** The original create request, replayed at materialization (keeps cwd/workspaceId). */
  request: Record<string, unknown>
  createdAt: number
}

/** Extract the `request` arg object from one dispatch's native args, when present. */
function requestArg(args: Record<string, unknown>): Record<string, unknown> {
  const request = args.request
  return typeof request === 'object' && request !== null && !Array.isArray(request)
    ? request as Record<string, unknown>
    : {}
}

/**
 * Intercept the Remote dispatch so `session/create` returns a provisional id
 * without creating anything; the real session materializes on the first
 * `session/prompt` for that id.
 *
 * @param dispatch - Inner Remote dispatch.
 * @param enabled - Whether deferral is active; false returns the dispatch untouched.
 * @returns the original dispatch when disabled, otherwise the intercepting dispatch.
 */
export function withSessionDeferral(dispatch: RpcDispatch, enabled: boolean): RpcDispatch {
  if (!enabled) return dispatch

  const provisional = new Map<string, ProvisionalEntry>()
  const materializing = new Map<string, Promise<RemoteWireResult>>()

  const prune = (): void => {
    const cutoff = Date.now() - PROVISIONAL_TTL_MS
    for (const [id, entry] of provisional) {
      if (entry.createdAt < cutoff) provisional.delete(id)
    }
  }

  return async (method, args, signal): Promise<RemoteWireResult> => {
    if (method === 'session/create') {
      prune()
      const request = requestArg(args)
      const sessionId = typeof request.sessionId === 'string' ? request.sessionId : `session-${randomUUID()}`
      provisional.set(sessionId, { request: { ...request }, createdAt: Date.now() })
      return { ok: true, value: { sessionId: sessionId as SessionId } }
    }
    if (method === 'session/prompt') {
      const request = requestArg(args)
      const sessionId = typeof request.sessionId === 'string' ? request.sessionId : undefined
      const entry = sessionId === undefined ? undefined : provisional.get(sessionId)
      if (sessionId === undefined || entry === undefined) return dispatch(method, args, signal)
      const existing = materializing.get(sessionId)
      const pending = existing ?? dispatch('session/create', { request: { ...entry.request, sessionId } }, signal)
      if (existing === undefined) {
        materializing.set(sessionId, pending)
        void pending.then(
          () => { materializing.delete(sessionId) },
          () => { materializing.delete(sessionId) },
        )
      }
      const created = await pending
      if (!created.ok) {
        // Materialization failed: relay the failure as the prompt answer so
        // the extension surfaces the real reason; the provisional entry
        // survives and the next prompt retries.
        return { ok: false, error: created.error }
      }
      provisional.delete(sessionId)
      return dispatch(method, args, signal)
    }
    return dispatch(method, args, signal)
  }
}
