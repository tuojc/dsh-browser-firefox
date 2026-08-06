/**
 * Background service worker entry: owns the bridge connection, the gateway
 * RPC client, tool dispatch to the active tab, and the panel port service.
 *
 * MV3 survival: the service worker is kept alive by the panel's open port
 * plus a half-minute `alarms` keepalive that re-arms the reconnect loop.
 *
 * Panel port protocol (chrome.runtime.connect, name "dsh-panel"):
 *   panel → bg: { type: 'rpc', id, method, payload }
 *   panel → bg: { type: 'settings', settings: Partial<Settings> }
 *   panel → bg: { type: 'request-status' }
 *   bg → panel: { type: 'rpc.result', id, ok, result? | error? }
 *   bg → panel: { type: 'status', state: BridgeState, caps? }
 *   bg → panel: { type: 'event', frame: ServerFrame }
 *
 * @module
 */

import type { BridgeCaps } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import type { ServerFrame } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import { BRIDGE_PATH } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import { BridgeClient, type BridgeState } from './bridge.ts'
import { createRpc } from './rpc.ts'
import { dispatchToolCall, type ToolCall } from './tools.ts'

/** User settings persisted in chrome.storage.local. */
export interface Settings {
  bridgeUrl: string
  token: string
  sharePageContent: 'ask' | 'auto' | 'off'
}

const SETTINGS_DEFAULTS: Settings = {
  // 空地址 = 自动探测本机 dsh（零配置）；手动填地址时优先手动。
  bridgeUrl: '',
  token: '',
  sharePageContent: 'ask',
}

/** 自动探测的候选端口（dsh web 默认 3080；--port 覆盖的常见值）。 */
const DISCOVERY_PORTS = [3080, 3081, 3090]

/** 探测本机 dsh 的桥地址：fetch /ext/bridge-config 直到成功。 */
async function discoverBridge(): Promise<string | undefined> {
  for (const port of DISCOVERY_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ext/bridge-config`, {
        signal: AbortSignal.timeout(1_500),
      })
      if (!response.ok) continue
      const body = await response.json() as { wsUrl?: unknown }
      if (typeof body.wsUrl === 'string' && body.wsUrl.startsWith('ws://')) return body.wsUrl
    } catch {
      // 该端口没有 dsh 或未挂桥：试下一个。
    }
  }
  return undefined
}

const STORAGE_KEY = 'dshSettings'

let settings: Settings = { ...SETTINGS_DEFAULTS }
let caps: BridgeCaps | null = null
let bridge: BridgeClient | null = null
let rpc: ReturnType<typeof createRpc> | null = null
const panelPorts = new Set<chrome.runtime.Port>()

async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY)
  return { ...SETTINGS_DEFAULTS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) }
}

async function persistSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next }
  await chrome.storage.local.set({ [STORAGE_KEY]: settings })
}

function broadcastStatus(): void {
  const payload = { type: 'status', state: bridge?.state ?? ('stopped' as BridgeState), caps }
  for (const port of panelPorts) {
    try { port.postMessage(payload) } catch { /* port already closed */ }
  }
}

function broadcastEvent(frame: ServerFrame): void {
  for (const port of panelPorts) {
    try { port.postMessage({ type: 'event', frame }) } catch { /* port already closed */ }
  }
}

/** 把协商的快照预算下发到活动标签页的 content script（配置生效）。 */
async function pushBudgetToActiveTab(negotiated: BridgeCaps): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) return
  try {
    await chrome.tabs.sendMessage(tab.id, {
      type: 'DSH_BUDGET',
      budget: { maxItems: negotiated.maxInteractiveItems, maxChars: negotiated.snapshotMaxChars },
    })
  } catch {
    // 页面尚未注入 content script：下一次快照仍用默认预算，可接受。
  }
}

/** Route one tool.call frame to the active tab and answer over the bridge. */
function routeToolCall(call: ToolCall): void {
  if (bridge === null) return
  const budget = caps === null
    ? undefined
    : { maxItems: caps.maxInteractiveItems, maxChars: caps.snapshotMaxChars }
  void dispatchToolCall(call, settings.sharePageContent, budget).then((answer) => {
    const socket = bridge
    if (socket === null) return
    if (answer.ok) {
      socket.send({ t: 'tool.result', id: call.id, ok: true, result: answer.result })
    } else {
      socket.send({ t: 'tool.result', id: call.id, ok: false, error: answer.error! })
    }
  })
}

/** (Re)start the bridge with the current settings. 零配置：地址留空时自动探测；回环连接无需 token。 */
async function startBridge(): Promise<void> {
  let url = settings.bridgeUrl
  if (url === '') {
    url = await discoverBridge() ?? ''
  }
  if (url === '') {
    bridge?.stop()
    bridge = null
    rpc = null
    broadcastStatus()
    return
  }
  // 手动填的地址常只有主机部分（如 ws://127.0.0.1:3080）；桥路径是协议
  // 常量，缺省时自动补全，避免连到根路径失败。
  try {
    const parsed = new URL(url)
    if (parsed.pathname === '' || parsed.pathname === '/') parsed.pathname = BRIDGE_PATH
    url = parsed.toString()
  } catch {
    // 非法 URL 原样交给 WebSocket 构造函数报错。
  }
  if (bridge === null) {
    const client = new BridgeClient({
      onStateChange: () => { broadcastStatus() },
      onFrame: (frame) => {
        if (frame.t === 'event') broadcastEvent(frame)
        else if (frame.t === 'tool.call') routeToolCall(frame)
        // rpc.result is settled by the rpc facade (wrapped below).
      },
      onHelloOk: (negotiated) => {
        caps = negotiated
        broadcastStatus()
        void pushBudgetToActiveTab(negotiated)
      },
    })
    bridge = client
    rpc = createRpc(client)
  }
  bridge.start(url, settings.token)
}

/** Gateway RPC with a helpful error when the bridge is down. */
async function gatewayRpc(method: string, payload: unknown): Promise<unknown> {
  if (rpc === null || bridge === null || !bridge.connected) {
    throw new Error('未连接 dsh（请检查设置中的地址与 token）')
  }
  return rpc.request(method, payload)
}

// ---- Panel ports ----

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dsh-panel') return
  panelPorts.add(port)
  try { port.postMessage({ type: 'status', state: bridge?.state ?? ('stopped' as BridgeState), caps }) } catch { /* port closed */ }
  port.onMessage.addListener((message: unknown) => {
    if (typeof message !== 'object' || message === null) return
    const msg = message as { type?: string }
    switch (msg.type) {
      case 'rpc': {
        const rpcMsg = message as { id: string; method: string; payload?: unknown }
        void gatewayRpc(rpcMsg.method, rpcMsg.payload).then(
          (result) => {
            try { port.postMessage({ type: 'rpc.result', id: rpcMsg.id, ok: true, result }) } catch { /* port closed */ }
          },
          (error: unknown) => {
            try {
              port.postMessage({
                type: 'rpc.result',
                id: rpcMsg.id,
                ok: false,
                error: { code: 'bridge-unavailable', message: error instanceof Error ? error.message : String(error) },
              })
            } catch { /* port closed */ }
          },
        )
        break
      }
      case 'settings': {
        const settingsMsg = message as { settings: Partial<Settings> }
        void persistSettings(settingsMsg.settings).then(async () => {
          await startBridge()
          broadcastStatus()
        })
        break
      }
      case 'request-status':
        broadcastStatus()
        break
    }
  })
  port.onDisconnect.addListener(() => { panelPorts.delete(port) })
})

// ---- Keepalive ----

chrome.alarms.create('bridge-keepalive', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'bridge-keepalive') return
  if (bridge !== null && bridge.state === 'reconnecting') void startBridge()
})

// ---- Boot ----

// Clicking the toolbar icon opens the side panel directly (Chrome 116+).
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})

void loadSettings().then(async (loaded) => {
  settings = loaded
  await startBridge()
})
