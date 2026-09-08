/**
 * REAL-composition coverage: a test-only cordis.yml booted through the
 * published Loader mounts the webserver, the tools spine (system-prompt +
 * tools), a test-only alpha host providing `ctx.typertGateway` with the REAL
 * alpha semantics (slash endpoints, native args, follow streams), and the
 * bridge plugin itself. A real WebSocket client then authenticates over a
 * real socket and drives native Typert bridge RPCs; the fake store observes
 * the business effects.
 *
 * Mocked boundary: everything above the Typert Gateway (real sessions, models,
 * persistence) — the dispatch chain, bridge protocol, workspace grouping, and
 * stream passthrough are the real plugin code under test.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import WebSocket from 'ws'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import * as BridgeBrowser from '../src/index.ts'
import { BRIDGE_PATH, type BridgeFrame } from '../src/protocol.ts'
import { createFakeAlphaHost, type FakeStore } from './helpers/alpha-host.ts'

const BRIDGE = '@deepseek-ai/dsh-bridge-browser'
const TOKEN = 'abcdabcdabcdabcdabcdabcdabcdabcd'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
  root = undefined
})

/** Write a dist fixture and the composition cordis.yml, then boot it through the real Loader. */
async function loadComposition(): Promise<{ ctx: Context; configPath: string; port: number; store: FakeStore }> {
  root = await mkdtemp(join(tmpdir(), 'dsh-bridge-browser-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [
    "- name: '@deepseek-ai/dsh-host-webserver'",
    '  config:',
    "    host: '127.0.0.1'",
    '    port: 0',
    "- name: '@deepseek-ai/dsh-system-prompt'",
    "- name: '@deepseek-ai/dsh-tools'",
    "- name: 'test:alpha-host'",
    `- name: '${BRIDGE}'`,
    '  config:',
    `    token: '${TOKEN}'`,
    `    sessionWorkspacePath: '${join(root, 'browser-sessions')}'`,
    // This spec drives the raw dispatch chain (create → real invoke); the
    // deferred-creation behavior is covered by the extension e2e instead.
    '    deferSessionCreate: false',
    '',
  ].join('\n'))

  const host = createFakeAlphaHost()
  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-host-webserver', WebServer],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRegistry],
    ['test:alpha-host', host.plugin],
    [BRIDGE, BridgeBrowser],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  const web = context.get('webServer') as typeof WebServer.prototype
  return { ctx: context, configPath, port: web.port, store: host.store }
}

/** 扩展上下文 Origin（回环免 token 的必要条件）。 */
const EXT_ORIGIN = 'chrome-extension://test-extension-id'

function connect(port: number): Promise<{ ws: WebSocket; frames: BridgeFrame[]; closed: Promise<void> }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${BRIDGE_PATH}`, { headers: { origin: EXT_ORIGIN } })
    const frames: BridgeFrame[] = []
    ws.on('message', (data) => { frames.push(JSON.parse(data.toString()) as BridgeFrame) })
    ws.on('error', reject)
    ws.on('open', () => {
      resolve({
        ws,
        frames,
        closed: new Promise<void>((doneResolve) => { ws.on('close', () => { doneResolve() }) }),
      })
    })
  })
}

function send(ws: WebSocket, frame: BridgeFrame): void {
  ws.send(JSON.stringify(frame))
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
}

/** Unwrap one rpc.result frame to its business value (the extension's reading). */
function businessValue(frame: BridgeFrame): unknown {
  if (frame.t !== 'rpc.result' || !frame.ok) throw new Error(`expected a successful rpc.result frame, got ${JSON.stringify(frame)}`)
  return frame.value
}

describe('real Loader composition', () => {
  it('boots the bridge, authenticates over a real socket, and drives native Typert RPCs and streams', { timeout: 60_000 }, async () => {
    const { ctx, port, store } = await loadComposition()

    // The bridge plugin mounted the browser tool set on the real registry.
    const tools = ctx.get('tools') as ToolRegistry
    expect(tools.get('browser_snapshot')).toBeDefined()

    // Zero-config discovery endpoint answers with the bridge WebSocket URL.
    const configResponse = await fetch(`http://127.0.0.1:${port}/ext/bridge-config`)
    expect(configResponse.status).toBe(200)
    // Firefox extensions fetch this cross-origin during auto-detection: ACAO required.
    expect(configResponse.headers.get('access-control-allow-origin')).toBe('*')
    const config = await configResponse.json() as { wsUrl?: unknown }
    expect(typeof config.wsUrl).toBe('string')
    expect(config.wsUrl).toBe(`ws://127.0.0.1:${port}/ext/bridge`)
    const preflight = await fetch(`http://127.0.0.1:${port}/ext/bridge-config`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-origin')).toBe('*')
    expect(tools.get('browser_click')).toBeDefined()
    expect(tools.get('browser_navigate')).toBeDefined()

    // Zero-config semantics: loopback connections need no token (the
    // non-loopback token gate is covered by server.spec overrides).
    const client = await connect(port)
    send(client.ws, { t: 'hello', token: '', caps: { textOnly: true, snapshotMaxChars: 12_000, maxInteractiveItems: 60 } })
    await waitFor(() => client.frames.some((f) => f.t === 'hello.ok'))
    expect(client.frames.find((f) => f.t === 'hello.ok')).toEqual({
      t: 'hello.ok',
      caps: { textOnly: true, snapshotMaxChars: 12_000, maxInteractiveItems: 120 },
    })

    // session/create flows through workspace grouping onto the fake alpha host.
    send(client.ws, { t: 'rpc', id: 'c-1', method: 'session/create', args: { request: { cwd: root } } })
    await waitFor(() => client.frames.some((f) => f.t === 'rpc.result' && f.id === 'c-1'))
    const created = client.frames.find((f): f is Extract<BridgeFrame, { t: 'rpc.result' }> => f.t === 'rpc.result' && f.id === 'c-1')!
    const sessionId = (businessValue(created) as { sessionId: string }).sessionId
    expect(sessionId).toMatch(/^session-[0-9a-f-]{36}$/)
    // Grouping happened: cwd was replaced by the browser-sessions workspace id,
    // and the workspace accounts the new session.
    const session = store.sessions.get(sessionId)
    expect(session).toBeDefined()
    expect(session!.cwd).toBeUndefined()
    const workspace = [...store.workspaces.values()].find((w) => w.path === join(root!, 'browser-sessions'))
    expect(workspace).toBeDefined()
    expect(session!.workspaceId).toBe(workspace!.workspaceId)
    expect(workspace!.sessionIds).toContain(sessionId)

    // workspace/follow streams the native baseline (with the new workspace).
    send(client.ws, { t: 'stream.open', id: 'w-1', method: 'workspace/follow', args: {} })
    await waitFor(() => client.frames.some((f) => f.t === 'stream.frame' && f.id === 'w-1'))
    const baseline = client.frames.find((f): f is Extract<BridgeFrame, { t: 'stream.frame' }> => f.t === 'stream.frame' && f.id === 'w-1')!
    const baselineFrame = baseline.frame as { type: string; value: { items: Array<{ workspaceId: string; sessionIds: string[] }> } }
    expect(baselineFrame.type).toBe('baseline')
    expect(baselineFrame.value.items.map((w) => w.workspaceId)).toContain(workspace!.workspaceId)
    expect(baselineFrame.value.items.find((w) => w.workspaceId === workspace!.workspaceId)!.sessionIds).toContain(sessionId)

    // session/list passes through (args key `_request`).
    send(client.ws, { t: 'rpc', id: 'c-2', method: 'session/list', args: { _request: {} } })
    await waitFor(() => client.frames.some((f) => f.t === 'rpc.result' && f.id === 'c-2'))
    const sessions = businessValue(client.frames.find((f) => f.t === 'rpc.result' && f.id === 'c-2')!) as { items: Array<{ sessionId: string }> }
    expect(sessions.items.map((s) => s.sessionId)).toContain(sessionId)

    // session/prompt with the extension-minted requestId reaches the host.
    send(client.ws, {
      t: 'rpc',
      id: 'p-1',
      method: 'session/prompt',
      args: { request: { sessionId, requestId: 'req-fixed', mode: 'queue', content: [{ type: 'text', text: 'hi' }] } },
    })
    await waitFor(() => client.frames.some((f) => f.t === 'rpc.result' && f.id === 'p-1'))
    const prompted = client.frames.find((f) => f.t === 'rpc.result' && f.id === 'p-1')!
    expect(businessValue(prompted)).toEqual({ accepted: true })
    expect(store.prompts).toHaveLength(1)
    expect(store.prompts[0]!.sessionId).toBe(sessionId)
    expect(store.prompts[0]!.requestId).toBe('req-fixed')

    // session/follow opens with the native snapshot (the prompt's event is in it).
    send(client.ws, {
      t: 'stream.open',
      id: 's-1',
      method: 'session/follow',
      args: { request: { address: { kind: 'session', sessionId } } },
    })
    await waitFor(() => client.frames.some((f) => f.t === 'stream.frame' && f.id === 's-1'))
    const snapshot = client.frames.find((f): f is Extract<BridgeFrame, { t: 'stream.frame' }> => f.t === 'stream.frame' && f.id === 's-1')!
    const snapshotFrame = snapshot.frame as { type: string; records: Array<{ type: string; event: { type: string } }> }
    expect(snapshotFrame.type).toBe('snapshot')
    expect(snapshotFrame.records.map((record) => record.event.type)).toEqual(['user/message'])

    // A second prompt's event arrives live on the open stream, unmodified.
    send(client.ws, {
      t: 'rpc',
      id: 'p-2',
      method: 'session/prompt',
      args: { request: { sessionId, requestId: 'req-2', mode: 'queue', content: [{ type: 'text', text: 'again' }] } },
    })
    await waitFor(() => client.frames.some((f) =>
      f.t === 'stream.frame' && f.id === 's-1' && (f.frame as { type: string }).type === 'event'))
    const live = client.frames.find((f): f is Extract<BridgeFrame, { t: 'stream.frame' }> =>
      f.t === 'stream.frame' && f.id === 's-1' && (f.frame as { type: string }).type === 'event')!
    expect((live.frame as { event: { type: string } }).event.type).toBe('user/message')

    // stream.close silences the subscription without killing the connection.
    send(client.ws, { t: 'stream.close', id: 's-1' })
    client.ws.close()
  })

  it('unregisters the browser tools when the bridge fiber disposes (HMR safety)', { timeout: 60_000 }, async () => {
    const { ctx, configPath } = await loadComposition()
    const tools = ctx.get('tools') as ToolRegistry
    expect(tools.get('browser_snapshot')).toBeDefined()

    const bridgeEntry = [...ctx.loader.entries()].find((entry) => entry.options.name === BRIDGE)!
    await bridgeEntry.fiber!.dispose()
    expect(tools.get('browser_snapshot')).toBeUndefined()
    expect(tools.get('browser_click')).toBeUndefined()
    // Self-disposing an include-tree entry persists `disabled: true`; await
    // that debounced write so it cannot race the temp-dir removal.
    await expect.poll(async () => (await readFile(configPath, 'utf8')).includes('disabled: true')).toBe(true)
  })
})
