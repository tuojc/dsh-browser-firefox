/**
 * Best-effort workspace grouping for sessions created through the browser
 * bridge. The wrapper changes only implicit `session.create` requests;
 * explicit workspace choices and every other gateway method pass through.
 * @module @yuxianglin/dsh-bridge-browser/src/session-workspace
 */

import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import type { ApiProxy, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'

type Warn = (message: string) => void

/**
 * Add a dedicated Workspace to implicit session creation without making
 * grouping a session-creation dependency. The first implicit create mkdirs
 * and registers the configured path; that result, including failure, is
 * cached for the wrapper lifetime.
 *
 * @param api - Injected gateway API implementation.
 * @param workspacePath - Dedicated directory, or an empty string to opt out.
 * @param warn - Logger called once when grouping cannot be established.
 * @returns the original API for opt-out, otherwise an API with wrapped session creation.
 */
export function withSessionWorkspace(
  api: ApiProxy,
  workspacePath: string,
  warn: Warn,
): ApiProxy {
  if (workspacePath === '') return api

  let workspacePromise: Promise<WorkspaceId | undefined> | undefined
  const ensureWorkspace = (): Promise<WorkspaceId | undefined> => {
    if (workspacePromise !== undefined) return workspacePromise
    workspacePromise = (async () => {
      try {
        await mkdir(workspacePath, { recursive: true })
        const workspaceApi = (api as { workspace?: ApiProxy['workspace'] }).workspace
        if (workspaceApi === undefined) {
          warn(`browser bridge: workspace API is unavailable; sessions will remain ungrouped`)
          return undefined
        }
        const response = await workspaceApi.create({
          rpcId: RpcId(randomUUID()),
          payload: { path: workspacePath },
        })
        if (!response.result.ok) {
          warn(
            `browser bridge: workspace.create failed for "${workspacePath}" `
            + `(${response.result.error.code}: ${response.result.error.message}); sessions will remain ungrouped`,
          )
          return undefined
        }
        return response.result.value.workspace.workspaceId
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

  return {
    ...api,
    sessions: {
      ...api.sessions,
      async create(request) {
        if (request.payload.workspaceId !== undefined) return api.sessions.create(request)
        const workspaceId = await ensureWorkspace()
        if (workspaceId === undefined) return api.sessions.create(request)
        const payload = { ...request.payload, workspaceId }
        delete payload.cwd
        return api.sessions.create({ ...request, payload })
      },
    },
  }
}
