/**
 * Best-effort workspace grouping for sessions created through the browser
 * bridge. The interceptor changes only implicit `session/create` requests;
 * explicit workspace choices and every other Remote endpoint pass through.
 * @module @deepseek-ai/dsh-bridge-browser/src/session-workspace
 */

import { mkdir } from 'node:fs/promises'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { RemoteWireResult } from './protocol.ts'

/**
 * Unary Remote dispatch seam: slash-joined endpoint, native args object,
 * RemoteResult wire form. The bridge server and the interceptors share it.
 */
export type RpcDispatch = (method: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<RemoteWireResult>

type Warn = (message: string) => void

/** Extract the `request` arg object from one dispatch's native args, when present. */
function requestArg(args: Record<string, unknown>): Record<string, unknown> {
  const request = args.request
  return typeof request === 'object' && request !== null && !Array.isArray(request)
    ? request as Record<string, unknown>
    : {}
}

/**
 * Add the dedicated Workspace to implicit session creation without making
 * grouping a session-creation dependency. The first implicit create mkdirs
 * and registers the configured path (`workspace/create`); that result,
 * including failure, is cached for the interceptor lifetime.
 *
 * @param dispatch - Inner Remote dispatch.
 * @param workspacePath - Dedicated directory, or an empty string to opt out.
 * @param warn - Logger called once when grouping cannot be established.
 * @returns the original dispatch for opt-out, otherwise a dispatch with intercepted session creation.
 */
export function withSessionWorkspace(
  dispatch: RpcDispatch,
  workspacePath: string,
  warn: Warn,
): RpcDispatch {
  if (workspacePath === '') return dispatch

  let workspacePromise: Promise<WorkspaceId | undefined> | undefined
  const ensureWorkspace = (): Promise<WorkspaceId | undefined> => {
    if (workspacePromise !== undefined) return workspacePromise
    workspacePromise = (async () => {
      try {
        await mkdir(workspacePath, { recursive: true })
        const result = await dispatch('workspace/create', { request: { path: workspacePath } }, new AbortController().signal)
        if (!result.ok) {
          warn(
            `browser bridge: workspace/create failed for "${workspacePath}" `
            + `(${result.error.code}: ${result.error.message}); sessions will remain ungrouped`,
          )
          return undefined
        }
        const workspace = (result.value as { workspace?: { workspaceId?: unknown } }).workspace
        const workspaceId = workspace?.workspaceId
        if (typeof workspaceId !== 'string') {
          warn(`browser bridge: workspace/create for "${workspacePath}" returned no workspace id; sessions will remain ungrouped`)
          return undefined
        }
        return workspaceId as WorkspaceId
      } catch (error: unknown) {
        warn(
          `browser bridge: could not prepare session workspace "${workspacePath}": `
          + `${String(error)}; sessions will remain ungrouped`,
        )
        return undefined
      }
    })()
    return workspacePromise
  }

  return async (method, args, signal) => {
    if (method !== 'session/create') return dispatch(method, args, signal)
    const request = requestArg(args)
    if (request.workspaceId !== undefined) return dispatch(method, args, signal)
    const workspaceId = await ensureWorkspace()
    if (workspaceId === undefined) return dispatch(method, args, signal)
    const next: Record<string, unknown> = { ...request, workspaceId }
    delete next.cwd
    return dispatch(method, { ...args, request: next }, signal)
  }
}
