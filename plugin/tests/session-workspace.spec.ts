import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/types'
import type { RemoteWireResult } from '../src/protocol.ts'
import { withSessionWorkspace, type RpcDispatch } from '../src/session-workspace.ts'

const WORKSPACE_ID = 'workspace-browser' as WorkspaceId
const SIGNAL = new AbortController().signal
const dirs: string[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempWorkspacePath(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-browser-workspace-'))
  dirs.push(root)
  return join(root, 'browser-sessions')
}

type DispatchMock = ReturnType<typeof vi.fn> & RpcDispatch

function dispatchHarness(workspaceCreate?: (args: Record<string, unknown>) => Promise<RemoteWireResult> | RemoteWireResult) {
  const calls: Array<{ method: string; args: Record<string, unknown> }> = []
  const dispatch = vi.fn(async (method: string, args: Record<string, unknown>): Promise<RemoteWireResult> => {
    calls.push({ method, args })
    if (method === 'workspace/create' && workspaceCreate !== undefined) return workspaceCreate(args)
    if (method === 'session/create') return { ok: true, value: { sessionId: 'session-browser' } }
    return { ok: true, value: null }
  }) as DispatchMock
  return { dispatch, calls }
}

function workspaceSuccess(inspect?: (path: string) => Promise<void>) {
  return vi.fn(async (args: Record<string, unknown>): Promise<RemoteWireResult> => {
    const path = (args.request as { path: string }).path
    await inspect?.(path)
    return {
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
    }
  })
}

describe('withSessionWorkspace', () => {
  it('creates the directory before one cached workspace registration and injects its id', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = workspaceSuccess(async (path) => {
      expect((await stat(path)).isDirectory()).toBe(true)
    })
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(dispatch, workspacePath, warn)

    await Promise.all([
      wrapped('session/create', { request: { cwd: '/ignored', sessionId: 'session-chosen' } }, SIGNAL),
      wrapped('session/create', { request: {} }, SIGNAL),
    ])

    expect(workspaceCreate).toHaveBeenCalledTimes(1)
    expect(workspaceCreate).toHaveBeenCalledWith({ request: { path: workspacePath } })
    const creates = calls.filter((call) => call.method === 'session/create')
    expect(creates[0]).toEqual({
      method: 'session/create',
      args: { request: { sessionId: 'session-chosen', workspaceId: WORKSPACE_ID } },
    })
    expect(creates[1]).toEqual({
      method: 'session/create',
      args: { request: { workspaceId: WORKSPACE_ID } },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes an explicit workspace id through without preparing the configured workspace', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = workspaceSuccess()
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const wrapped = withSessionWorkspace(dispatch, workspacePath, vi.fn())

    await wrapped('session/create', { request: { workspaceId: 'workspace-explicit' } }, SIGNAL)

    expect(calls).toEqual([{ method: 'session/create', args: { request: { workspaceId: 'workspace-explicit' } } }])
    expect(workspaceCreate).not.toHaveBeenCalled()
    await expect(stat(workspacePath)).rejects.toThrow()
  })

  it('returns the original dispatch when grouping is opted out', () => {
    const workspaceCreate = workspaceSuccess()
    const { dispatch } = dispatchHarness(workspaceCreate)

    expect(withSessionWorkspace(dispatch, '', vi.fn())).toBe(dispatch)
    expect(workspaceCreate).not.toHaveBeenCalled()
  })

  it('caches a missing workspace id in the response and falls through to plain session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    // workspace/create succeeds but the value carries no workspace view.
    const workspaceCreate = vi.fn(async (): Promise<RemoteWireResult> => ({ ok: true, value: { created: true } }))
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(dispatch, workspacePath, warn)

    await wrapped('session/create', { request: { cwd: '/original' } }, SIGNAL)
    await wrapped('session/create', { request: { cwd: '/original' } }, SIGNAL)

    const creates = calls.filter((call) => call.method === 'session/create')
    expect(creates).toHaveLength(2)
    expect(creates[0]).toEqual({ method: 'session/create', args: { request: { cwd: '/original' } } })
    expect(warn).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('returned no workspace id'))
  })

  it('caches a workspace/create business failure and preserves session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = vi.fn(async (): Promise<RemoteWireResult> => ({
      ok: false,
      error: { code: 'internal', message: 'workspace service missing', details: {} },
    }))
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(dispatch, workspacePath, warn)

    await wrapped('session/create', { request: {} }, SIGNAL)
    await wrapped('session/create', { request: {} }, SIGNAL)

    expect(workspaceCreate).toHaveBeenCalledOnce()
    const creates = calls.filter((call) => call.method === 'session/create')
    expect(creates).toHaveLength(2)
    expect(creates[0]!.args).toEqual({ request: {} })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('workspace/create failed'))
  })

  it('catches a thrown workspace failure and preserves session creation', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = vi.fn(async (): Promise<RemoteWireResult> => { throw new Error('domain unavailable') })
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const warn = vi.fn()
    const wrapped = withSessionWorkspace(dispatch, workspacePath, warn)

    await wrapped('session/create', { request: { cwd: '/original' } }, SIGNAL)

    const creates = calls.filter((call) => call.method === 'session/create')
    expect(creates).toEqual([{ method: 'session/create', args: { request: { cwd: '/original' } } }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('domain unavailable'))
  })

  it('never intercepts non-create methods', async () => {
    const workspacePath = await tempWorkspacePath()
    const workspaceCreate = workspaceSuccess()
    const { dispatch, calls } = dispatchHarness(workspaceCreate)
    const wrapped = withSessionWorkspace(dispatch, workspacePath, vi.fn())

    await wrapped('session/list', { _request: {} }, SIGNAL)

    expect(calls).toEqual([{ method: 'session/list', args: { _request: {} } }])
    expect(workspaceCreate).not.toHaveBeenCalled()
  })
})
