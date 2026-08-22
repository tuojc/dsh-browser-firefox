import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ApiProxy, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { withSessionWorkspace } from '../src/session-workspace.ts'

const WORKSPACE_ID = 'workspace-browser' as WorkspaceId
const SESSION_ID = SessionId('session-browser')
const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempWorkspacePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-workspace-'))
  dirs.push(root)
  return join(root, 'browser-sessions')
}

function sessionRequest(
  payload: Parameters<ApiProxy['sessions']['create']>[0]['payload'] = {},
  rpcId = 'session-rpc',
): Parameters<ApiProxy['sessions']['create']>[0] {
  return { rpcId: RpcId(rpcId), payload }
}

function apiHarness(options: {
  workspace?: ApiProxy['workspace']['create']
} = {}) {
  const sessionCreate = vi.fn(async (request: Parameters<ApiProxy['sessions']['create']>[0]) => ({
    rpcId: request.rpcId,
    result: { ok: true as const, value: { sessionId: SESSION_ID } },
  }))
  const api = {
    sessions: { create: sessionCreate },
    ...(options.workspace === undefined ? {} : { workspace: { create: options.workspace } }),
  } as unknown as ApiProxy
  return { api, sessionCreate }
}

function workspaceSuccess(
  inspect?: (path: string) => Promise<void>,
): ApiProxy['workspace']['create'] {
  return vi.fn(async (request) => {
    const path = request.payload.path as string
    await inspect?.(path)
    return {
      rpcId: request.rpcId,
      result: {
        ok: true,
        value: {
          created: true,
          workspace: {
            workspaceId: WORKSPACE_ID,
            path,
            title: 'browser-sessions',
            sessionIds: [],
            createdAt: '2026-08-06T00:00:00.000Z',
            updatedAt: '2026-08-06T00:00:00.000Z',
          },
        },
      },
    }
  })
}

describe('withSessionWorkspace', () => {
  it('creates the directory before one cached workspace registration and injects its id', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = workspaceSuccess(async (path) => {
      expect((await stat(path)).isDirectory()).toBe(true)
    })
    const { api, sessionCreate } = apiHarness({ workspace: workspaceCreate })
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(api, workspacePath, warn)
    const chosenId = SessionId('session-chosen')

    await Promise.all([
      wrapped.sessions.create(sessionRequest({ cwd: '/ignored', sessionId: chosenId }, 'first')),
      wrapped.sessions.create(sessionRequest({}, 'second')),
    ])

    expect(workspaceCreate).toHaveBeenCalledTimes(1)
    expect(workspaceCreate).toHaveBeenCalledWith(expect.objectContaining({ payload: { path: workspacePath } }))
    expect(sessionCreate).toHaveBeenNthCalledWith(1, {
      rpcId: RpcId('first'),
      payload: { sessionId: chosenId, workspaceId: WORKSPACE_ID },
    })
    expect(sessionCreate).toHaveBeenNthCalledWith(2, {
      rpcId: RpcId('second'),
      payload: { workspaceId: WORKSPACE_ID },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes an explicit workspace id through without preparing the configured workspace', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = workspaceSuccess()
    const { api, sessionCreate } = apiHarness({ workspace: workspaceCreate })
    const wrapped = withSessionWorkspace(api, workspacePath, vi.fn())
    const request = sessionRequest({ workspaceId: 'workspace-explicit' as WorkspaceId })

    await wrapped.sessions.create(request)

    expect(sessionCreate).toHaveBeenCalledWith(request)
    expect(workspaceCreate).not.toHaveBeenCalled()
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('returns the original API when grouping is opted out', () => {
    const workspaceCreate = workspaceSuccess()
    const { api } = apiHarness({ workspace: workspaceCreate })

    expect(withSessionWorkspace(api, '', vi.fn())).toBe(api)
    expect(workspaceCreate).not.toHaveBeenCalled()
  })

  it('caches a missing workspace domain and falls through to plain session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    const { api, sessionCreate } = apiHarness()
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(api, workspacePath, warn)
    const request = sessionRequest({ cwd: '/original' })

    await wrapped.sessions.create(request)
    await wrapped.sessions.create(request)

    expect(sessionCreate).toHaveBeenCalledTimes(2)
    expect(sessionCreate).toHaveBeenNthCalledWith(1, request)
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace API is unavailable'))
  })

  it('caches a workspace.create business failure and preserves session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = vi.fn(async (request: Parameters<ApiProxy['workspace']['create']>[0]) => ({
      rpcId: request.rpcId,
      result: {
        ok: false as const,
        error: { code: 'internal' as const, message: 'workspace service missing', details: {} },
      },
    }))
    const { api, sessionCreate } = apiHarness({ workspace: workspaceCreate })
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(api, workspacePath, warn)
    const request = sessionRequest()

    await wrapped.sessions.create(request)
    await wrapped.sessions.create(request)

    expect(workspaceCreate).toHaveBeenCalledOnce()
    expect(sessionCreate).toHaveBeenCalledTimes(2)
    expect(sessionCreate).toHaveBeenNthCalledWith(1, request)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace.create failed'))
  })

  it('catches a thrown workspace failure and preserves session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = vi.fn(async () => { throw new Error('domain unavailable') })
    const { api, sessionCreate } = apiHarness({ workspace: workspaceCreate })
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(api, workspacePath, warn)
    const request = sessionRequest({ cwd: '/original' })

    await wrapped.sessions.create(request)

    expect(sessionCreate).toHaveBeenCalledWith(request)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('domain unavailable'))
  })
})
