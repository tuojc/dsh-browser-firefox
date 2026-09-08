/**
 * Test-only alpha host: an in-memory TypertGateway stand-in with the real
 * alpha semantics (slash endpoints, native `{ request | _request }` args,
 * RemoteError-shaped failures, follow streams with baseline/snapshot opening
 * frames).
 *
 * The composition and e2e specs boot the bridge plugin against this host
 * through the real Loader, so the dispatch chain and stream passthrough are
 * exercised end-to-end without booting the real Session/Workspace spine.
 *
 * @module
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionFollowFrame, SessionWireEvent } from '@deepseek-ai/dsh-api-session-controller/types'
import type { WorkspaceFollowFrame, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/types'

/** One fake session row. */
export interface FakeSession {
  sessionId: string
  cwd?: string
  workspaceId?: string
  updatedAt: number
  events: SessionWireEvent[]
}

/** Observable state the specs assert against. */
export interface FakeStore {
  sessions: Map<string, FakeSession>
  workspaces: Map<string, WorkspaceView>
  /** Every prompt request the host accepted (post-passthrough). */
  prompts: Array<{ sessionId: string; mode: string; requestId?: string; content: unknown }>
}

/** Carrier-facing failure shape (matches TypertGatewayWireStream.failure). */
interface WireFailure {
  code: string
  message: string
  details: object
}

/** Test double for RemoteError: a real Error carrying code/details. */
class FakeRemoteError extends Error {
  readonly isDSHRemoteError = true
  constructor(readonly code: string, message: string, readonly details: object = {}) {
    super(message)
    this.name = 'FakeRemoteError'
  }
}

function failureOf(error: unknown): WireFailure {
  if (typeof error === 'object' && error !== null && 'code' in error && 'message' in error) {
    const typed = error as { code: unknown; message: unknown }
    if (typeof typed.code === 'string' && typeof typed.message === 'string') {
      return { code: typed.code, message: typed.message, details: {} }
    }
  }
  return { code: 'internal', message: String(error), details: {} }
}

/** A LiveQueue feeds follow-stream generators and respects the stream signal. */
class LiveQueue<T> {
  private readonly queue: T[] = []
  private wake: (() => void) | undefined

  push(value: T): void {
    this.queue.push(value)
    this.wake?.()
  }

  async *iterate(signal: AbortSignal): AsyncIterable<T> {
    const onAbort = (): void => { this.wake?.() }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      while (!signal.aborted) {
        while (this.queue.length > 0) {
          const value = this.queue.shift()
          if (value !== undefined) yield value
        }
        if (signal.aborted) break
        await new Promise<void>((resolve) => { this.wake = resolve })
        this.wake = undefined
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * Create the fake alpha host. `store` is returned so specs can assert the
 * business effects directly.
 */
export function createFakeAlphaHost(): { plugin: { name: string; apply: (ctx: Context) => void }; store: FakeStore } {
  const store: FakeStore = { sessions: new Map(), workspaces: new Map(), prompts: [] }
  const workspaceFollowers = new Set<LiveQueue<WorkspaceFollowFrame>>()
  const sessionFollowers = new Map<string, Set<LiveQueue<SessionFollowFrame>>>()

  const saveWorkspace = (workspace: WorkspaceView): void => {
    store.workspaces.set(workspace.workspaceId, workspace)
    for (const follower of workspaceFollowers) follower.push({ type: 'upsert', workspace })
  }

  const emitSessionEvent = (sessionId: string, event: SessionWireEvent): void => {
    const session = store.sessions.get(sessionId)
    if (session !== undefined) {
      session.events.push(event)
      session.updatedAt = event.time
    }
    for (const follower of sessionFollowers.get(sessionId) ?? []) {
      follower.push({ type: 'event', event })
    }
  }

  /** Unary business endpoints, keyed by the alpha slash endpoint. */
  const invokeEndpoint = (endpoint: string, args: Record<string, unknown>): unknown => {
    switch (endpoint) {
      case 'session/create': {
        const request = (args.request ?? {}) as { workspaceId?: string; cwd?: string; sessionId?: string }
        const sessionId = request.sessionId ?? `session-${randomUUID()}`
        if (!store.sessions.has(sessionId)) {
          const session: FakeSession = { sessionId, updatedAt: Date.now(), events: [] }
          if (request.cwd !== undefined) session.cwd = request.cwd
          if (request.workspaceId !== undefined) session.workspaceId = request.workspaceId
          store.sessions.set(sessionId, session)
          const workspace = request.workspaceId === undefined ? undefined : store.workspaces.get(request.workspaceId)
          if (workspace !== undefined) {
            saveWorkspace({ ...workspace, sessionIds: [...workspace.sessionIds, sessionId as never], updatedAt: new Date().toISOString() })
          }
        }
        return { sessionId }
      }
      case 'session/list': {
        return {
          items: [...store.sessions.values()]
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map((session) => ({ sessionId: session.sessionId, updatedAt: session.updatedAt, running: false, blank: session.events.length === 0 })),
        }
      }
      case 'session/prompt': {
        const request = args.request as { sessionId: string; mode: string; requestId?: string; content: unknown }
        if (!store.sessions.has(request.sessionId)) {
          throw new FakeRemoteError('session/not-found', `session ${request.sessionId} not found`)
        }
        store.prompts.push(request)
        emitSessionEvent(request.sessionId, {
          type: 'user/message',
          seq: store.sessions.get(request.sessionId)!.events.length + 1,
          time: Date.now(),
          data: { content: request.content, source: { kind: 'user' } },
        })
        return { accepted: true }
      }
      case 'session/cancel':
        return { accepted: true }
      case 'workspace/create': {
        const request = args.request as { path: string }
        const existing = [...store.workspaces.values()].find((workspace) => workspace.path === request.path)
        if (existing !== undefined) return { workspace: existing, created: false }
        const workspace: WorkspaceView = {
          workspaceId: `workspace-${randomUUID()}` as WorkspaceView['workspaceId'],
          path: request.path,
          title: request.path.split('/').pop() ?? request.path,
          sessionIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        saveWorkspace(workspace)
        return { workspace, created: true }
      }
      default:
        throw new FakeRemoteError('gateway/lookup-not-found', `unknown endpoint ${endpoint}`)
    }
  }

  /** Stream endpoints: `workspace/follow` and `session/follow`. */
  const streamEndpoint = (endpoint: string, args: Record<string, unknown>, signal: AbortSignal): AsyncIterable<unknown> => {
    if (endpoint === 'workspace/follow') {
      const queue = new LiveQueue<WorkspaceFollowFrame>()
      workspaceFollowers.add(queue)
      return (async function* (): AsyncIterable<WorkspaceFollowFrame> {
        try {
          yield { type: 'baseline', value: { items: [...store.workspaces.values()], archivedSessionIds: [] } }
          yield* queue.iterate(signal)
        } finally {
          workspaceFollowers.delete(queue)
        }
      })()
    }
    if (endpoint === 'session/follow') {
      const request = args.request as { address: { kind: string; sessionId: string } }
      const sessionId = request.address.sessionId
      const session = store.sessions.get(sessionId)
      if (session === undefined) {
        throw new FakeRemoteError('session/not-found', `session ${sessionId} not found`)
      }
      const queue = new LiveQueue<SessionFollowFrame>()
      const followers = sessionFollowers.get(sessionId) ?? new Set<LiveQueue<SessionFollowFrame>>()
      sessionFollowers.set(sessionId, followers)
      followers.add(queue)
      return (async function* (): AsyncIterable<SessionFollowFrame> {
        try {
          const snapshotSession = store.sessions.get(sessionId)!
          yield {
            type: 'snapshot',
            header: { version: 0, id: sessionId as never, createdAt: 0 },
            cursor: snapshotSession.events.length,
            records: snapshotSession.events.map((event) => ({ type: 'event' as const, event })),
            hasMore: false,
            projections: { asOfSeq: snapshotSession.events.length, values: {} },
          }
          yield* queue.iterate(signal)
        } finally {
          followers.delete(queue)
        }
      })()
    }
    throw new FakeRemoteError('gateway/lookup-not-found', `unknown stream endpoint ${endpoint}`)
  }

  const plugin = {
    name: 'alpha-host',
    apply(ctx: Context): void {
      // The one service the bridge consumes: TypertGateway with invoke/stream
      // plus the carrier-facing failure mapper.
      ctx.provide('typertGateway', {
        invoke: async (request: { namespace: string; method: string; args: Record<string, unknown> }) =>
          invokeEndpoint(`${request.namespace}/${request.method}`, request.args),
        stream: async (request: { namespace: string; method: string; args: Record<string, unknown>; signal?: AbortSignal }) =>
          streamEndpoint(`${request.namespace}/${request.method}`, request.args, request.signal ?? new AbortController().signal),
        wireStream: {
          open: async () => { throw new Error('unused in this composition') },
          failure: failureOf,
        },
        registerRemoteEvents: () => async () => {},
      })
    },
  }
  return { plugin, store }
}
