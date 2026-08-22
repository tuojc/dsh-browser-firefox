/**
 * Background service worker entry: owns the bridge connection, the gateway
 * RPC client, tool dispatch to the active tab, and the panel port service.
 *
 * MV3 survival: the service worker is kept alive by the panel's open port
 * plus a half-minute `alarms` keepalive that re-arms the reconnect loop.
 *
 * Panel port protocol (browser.runtime.connect, name "dsh-panel"):
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
import { BRIDGE_CONFIG_PATH, BRIDGE_PATH } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import { BridgeClient, type BridgeState } from './bridge.ts'
import { createRpc } from './rpc.ts'
import { dispatchToolCall, type ToolCall, type ToolAnswer, type ContentBudget } from './tools.ts'

/** User settings persisted in browser.storage.local. */
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
const LEGACY_LOCAL_URL = 'ws://127.0.0.1:3080'

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

/** Avoid opening a noisy loopback WebSocket until the local bridge responds. */
async function probeBridge(url: string): Promise<boolean> {
  try {
    const target = new URL(url)
    if (target.hostname !== '127.0.0.1') return true
    target.protocol = target.protocol === 'wss:' ? 'https:' : 'http:'
    target.pathname = BRIDGE_CONFIG_PATH
    target.search = ''
    target.hash = ''
    const response = await fetch(target, { signal: AbortSignal.timeout(1_500) })
    if (!response.ok) return false
    const body = await response.json() as { wsUrl?: unknown }
    return typeof body.wsUrl === 'string' && body.wsUrl.startsWith('ws://')
  } catch {
    return false
  }
}

const STORAGE_KEY = 'dshSettings'

let settings: Settings = { ...SETTINGS_DEFAULTS }
let caps: BridgeCaps | null = null
let bridge: BridgeClient | null = null
let rpc: ReturnType<typeof createRpc> | null = null
const panelPorts = new Set<chrome.runtime.Port>()

async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(STORAGE_KEY)
  const loaded = { ...SETTINGS_DEFAULTS, ...(stored[STORAGE_KEY] as Partial<Settings> | undefined) }
  if (loaded.bridgeUrl === LEGACY_LOCAL_URL || loaded.bridgeUrl === `${LEGACY_LOCAL_URL}/`) {
    loaded.bridgeUrl = ''
    await browser.storage.local.set({ [STORAGE_KEY]: loaded })
  }
  return loaded
}

async function persistSettings(next: Partial<Settings>): Promise<void> {
  settings = { ...settings, ...next }
  await browser.storage.local.set({ [STORAGE_KEY]: settings })
}

/** postMessage 到 panel port；失败（已断开）时立即从集合移除，避免后续再发。 */
function postToPort(port: chrome.runtime.Port, message: unknown): void {
  try {
    port.postMessage(message)
  } catch {
    panelPorts.delete(port)
  }
}

function broadcastStatus(): void {
  const payload = { type: 'status', state: bridge?.state ?? ('stopped' as BridgeState), caps }
  for (const port of [...panelPorts]) postToPort(port, payload)
}

function broadcastEvent(frame: ServerFrame): void {
  for (const port of [...panelPorts]) postToPort(port, { type: 'event', frame })
}

/** 把协商的快照预算下发到活动标签页的 content script（配置生效）。 */
async function pushBudgetToActiveTab(negotiated: BridgeCaps): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) return
  try {
    await browser.tabs.sendMessage(tab.id, {
      type: 'DSH_BUDGET',
      budget: { maxItems: negotiated.maxInteractiveItems, maxChars: negotiated.snapshotMaxChars },
    })
  } catch {
    // 页面尚未注入 content script：下一次快照仍用默认预算，可接受。
  }
}

/** Session-scoped tab group: maps a dsh sessionId to its Firefox tab group id. */
const sessionGroups = new Map<string, number>()
/** 当前工作的标签页 id（navigate/点击链接新建的 tab）；后续操作静默作用于此 tab。 */
let workingTabId: number | undefined
/** 当前工作 tab 所属的 group（页面自开新 tab 时自动归组用）。 */
let workingGroupId: number | undefined
/** session 打开的 tab 顺序（去重，栈顶为最近打开），供 browser_back 回退与 browser_list_tabs 列出。 */
let tabStack: number[] = []
/** 当前 session id（用于 session 切换时重置 tab 栈）。 */
let currentSessionId: string | undefined

/** session 切换时重置工作 tab / group / 栈，避免串到上一个 session 的 tab。 */
function ensureSession(sessionId: string | undefined): void {
  if (sessionId === currentSessionId) return
  currentSessionId = sessionId
  workingTabId = undefined
  workingGroupId = undefined
  tabStack = []
}
/** Color palette cycled per new group (Firefox tabGroups.ColorEnum). */
const GROUP_COLORS: chrome.tabGroups.ColorEnum[] = ['blue', 'green', 'red', 'purple', 'yellow', 'orange', 'pink', 'cyan', 'grey']
let groupColorIndex = 0

/** 校验 http/https URL，非法返回 undefined。 */
function safeHttpUrl(raw: string): URL | undefined {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : undefined
  } catch {
    return undefined
  }
}

/** 从 URL 提取简短域名标题（去 www. 前缀），作为 tab group 的任务名。 */
function titleFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'dsh'
  }
}

/**
 * Create a new active tab and add it to the session's tab group.
 * The group is created on first use and reused for the rest of the session,
 * so continuous work in one conversation stays together (color-coded).
 */
async function createTabInGroup(url: string, sessionId: string | undefined, title?: string): Promise<chrome.tabs.Tab> {
  // 静默新建：active:false 不抢焦点，Agent 在后台操作。
  const tab = await browser.tabs.create({ url, active: false })
  workingTabId = tab.id
  if (tab.id !== undefined) pushTab(tab.id)
  if (tab.id === undefined || sessionId === undefined) return tab
  try {
    const existing = sessionGroups.get(sessionId)
    let groupId: number
    if (existing !== undefined) {
      groupId = await browser.tabs.group({ tabIds: [tab.id], groupId: existing })
    } else {
      groupId = await browser.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } })
      sessionGroups.set(sessionId, groupId)
      const color = GROUP_COLORS[groupColorIndex++ % GROUP_COLORS.length]
      const groupTitle = title || titleFromUrl(url)
      try {
        await browser.tabGroups.update(groupId, { color, title: groupTitle })
      } catch (error) { console.warn('[dsh-browser] tab group color/title failed:', error) }
    }
    workingGroupId = groupId
  } catch (error) {
    // tabGroups 不可用（如更旧的 Firefox）时降级：tab 已创建，只是未分组。
    console.warn('[dsh-browser] tab group failed (tab 仍已创建，仅未分组):', error)
  }
  return tab
}

/** browser_navigate：新建标签页打开（不覆盖当前页），并归入当前会话的 group。 */
/** browser_screenshot：截取工作 tab（或活动 tab）为 data URL，回传 bridge 保存。 */
async function screenshotAction(): Promise<ToolAnswer> {
  const targetId = workingTabId
    ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id
  if (targetId === undefined) {
    return { ok: false, error: { code: 'no-active-tab', message: '没有可截图的标签页' } }
  }
  try {
    // captureTab 是 Firefox 特有 API（可截后台 tab），@types/chrome 未收录，用类型断言。
    const capture = browser.tabs as unknown as { captureTab: (tabId: number) => Promise<string> }
    const dataUrl = await capture.captureTab(targetId)
    return { ok: true, result: dataUrl }
  } catch (error) {
    return { ok: false, error: { code: 'action-failed', message: `截图失败: ${error instanceof Error ? error.message : String(error)}` } }
  }
}

async function navigateAction(call: ToolCall, sessionId: string | undefined, title?: string): Promise<ToolAnswer> {
  const url = typeof call.args.url === 'string' ? call.args.url : ''
  const parsed = safeHttpUrl(url)
  if (parsed === undefined) {
    return { ok: false, error: { code: 'bad-args', message: url === '' ? 'url 不能为空' : `仅支持 http/https 地址: ${url}` } }
  }
  // 1. 先在当前 session group 里查已有 tab（同页）→ 切回，不重复新建
  const existing = await findTabByPage(parsed.href)
  if (existing?.id !== undefined) {
    workingTabId = existing.id
    return { ok: true, result: { text: `已切换到已有标签页 ${parsed.href}…` } }
  }
  // 2. 否则新建
  await createTabInGroup(parsed.href, sessionId, title)
  return { ok: true, result: { text: `已在后台新标签页打开 ${parsed.href}…` } }
}

/** 在当前 session group 里查找「相同页面（origin+pathname+search，忽略 hash）」的 tab。 */
async function findTabByPage(url: string): Promise<chrome.tabs.Tab | undefined> {
  // 还没建 group（workingGroupId 空）时不检测，直接新建 + 建 group，避免切到用户没关的 tab
  if (workingGroupId === undefined) return undefined
  const target = new URL(url)
  const tabs = await browser.tabs.query({})
  return tabs.find((t) => {
    // 只查当前 session 的 group（groupId === workingGroupId）
    if (t.groupId !== workingGroupId) return false
    if (t.url === undefined || !/^https?:\/\//.test(t.url)) return false
    try {
      const u = new URL(t.url)
      return u.origin === target.origin && u.pathname === target.pathname && u.search === target.search
    } catch { return false }
  })
}

/** browser_click：先让 content script 解析目标元素；若是链接则新建标签页 + 入 group，否则普通点击。 */
async function clickAction(call: ToolCall, sessionId: string | undefined, budget: ContentBudget | undefined, title?: string): Promise<ToolAnswer> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) {
    return { ok: false, error: { code: 'no-active-tab', message: '没有活动的标签页可操作' } }
  }
  try {
    const info = await browser.tabs.sendMessage(tab.id, { type: 'DSH_RESOLVE_ELEMENT', index: call.args.index })
    const resolved = info as { isLink?: boolean; href?: string } | undefined
    if (resolved?.isLink === true && typeof resolved.href === 'string') {
      const parsed = safeHttpUrl(resolved.href)
      if (parsed !== undefined) {
        await createTabInGroup(parsed.href, sessionId, title)
        return { ok: true, result: { text: `已在后台新标签页打开 ${parsed.href}…` } }
      }
    }
  } catch {
    // content script 未就绪或解析失败：回退到普通 dispatch（会触发注入恢复）。
  }
  return dispatchToolCall(call, settings.sharePageContent, budget, workingTabId)
}

/** browser_back：栈中有上一个 tab 时切回，栈底退化到页面 history.back()。 */
async function backAction(call: ToolCall, budget: ContentBudget | undefined): Promise<ToolAnswer> {
  const idx = tabStack.lastIndexOf(workingTabId ?? -1)
  if (idx > 0) {
    workingTabId = tabStack[idx - 1]
    return { ok: true, result: { text: '已回到上一个标签页' } }
  }
  return dispatchToolCall(call, settings.sharePageContent, budget, workingTabId)
}

/** browser_list_tabs：列出当前 session group 的所有 tab。 */
async function listTabsAction(): Promise<ToolAnswer> {
  const tabs = await browser.tabs.query({})
  const items = tabs
    .filter((t) => workingGroupId === undefined || t.groupId === workingGroupId)
    .map((t) => {
      const mark = t.id === workingTabId ? ' *' : ''
      return `[${t.id}]${mark} ${t.title ?? '(无标题)'} ${t.url ?? ''}`
    })
  return { ok: true, result: { text: items.length > 0 ? items.join('\n') : '(无标签页)' } }
}

/** Route one tool.call frame to the active tab and answer over the bridge. */
function routeToolCall(call: ToolCall, sessionId: string | undefined, title: string | undefined): void {
  if (bridge === null) return
  ensureSession(sessionId)
  const budget = caps === null
    ? undefined
    : { maxItems: caps.maxInteractiveItems, maxChars: caps.snapshotMaxChars }
  const sendAnswer = (answer: ToolAnswer): void => {
    const socket = bridge
    if (socket === null) return
    if (answer.ok) {
      socket.send({ t: 'tool.result', id: call.id, ok: true, result: answer.result })
    } else {
      socket.send({ t: 'tool.result', id: call.id, ok: false, error: answer.error! })
    }
  }
  let promise: Promise<ToolAnswer>
  if (call.name === 'browser_navigate') {
    promise = navigateAction(call, sessionId, title)
  } else if (call.name === 'browser_click') {
    promise = clickAction(call, sessionId, budget, title)
  } else if (call.name === 'browser_screenshot') {
    promise = screenshotAction()
  } else if (call.name === 'browser_back') {
    promise = backAction(call, budget)
  } else if (call.name === 'browser_list_tabs') {
    promise = listTabsAction()
  } else {
    promise = dispatchToolCall(call, settings.sharePageContent, budget, workingTabId)
  }
  void promise.then(sendAnswer)
}

/** (Re)start the bridge with the current settings. 零配置：地址留空时自动探测；回环连接无需 token。 */
async function startBridge(): Promise<void> {
  let url = settings.bridgeUrl
  if (url === '') {
    url = await discoverBridge() ?? LEGACY_LOCAL_URL // Firefox: fetch 自动发现受 CORS 限制，失败时回退默认地址（WebSocket 本身不受 CORS 限制）
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
        else if (frame.t === 'tool.call') routeToolCall(frame, frame.sessionId, frame.title)
        // rpc.result is settled by the rpc facade (wrapped below).
      },
      onHelloOk: (negotiated) => {
        caps = negotiated
        broadcastStatus()
        void pushBudgetToActiveTab(negotiated)
      },
    }, probeBridge)
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

browser.runtime.onConnect.addListener((port) => {
  if (port.name !== 'dsh-panel') return
  panelPorts.add(port)
  if (bridge === null) void startBridge()
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

// ---- Tab follow & group ----
// 点击导致页面自己开新 tab（target=_blank / window.open）时，
// 工作 tab 跟随到新 tab，并归入当前 session 的 group。
// openerTabId 在 onCreated 时可能尚未设置（Firefox 异步），故用 onUpdated 兜底。

const pendingFollowTabs = new Set<number>()

/** 工作 tab 跟随到新 tab，并归组。 */
function followTab(tab: chrome.tabs.Tab): void {
  if (tab.id === undefined) return
  workingTabId = tab.id
  pushTab(tab.id)
  if (workingGroupId !== undefined) {
    void browser.tabs.group({ tabIds: [tab.id], groupId: workingGroupId }).catch(() => {})
  }
}

browser.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) {
    if (tab.openerTabId === workingTabId) followTab(tab)
  } else if (tab.id !== undefined) {
    pendingFollowTabs.add(tab.id)
  }
})

browser.tabs.onActivated.addListener((activeInfo) => {
  if (!pendingFollowTabs.has(activeInfo.tabId)) return
  pendingFollowTabs.delete(activeInfo.tabId)
  void browser.tabs.get(activeInfo.tabId).then((tab) => {
    // 只跟随 http/https 网页（排除 about:newtab 等用户手动开的 tab）
    if (!/^https?:\/\//.test(tab.url ?? '')) return
    followTab(tab)
  }).catch(() => {})
})

/** 压栈：先移除栈中重复 id 再 push（去重，栈顶最新）。 */
function pushTab(tabId: number): void {
  tabStack = tabStack.filter((id) => id !== tabId)
  tabStack.push(tabId)
}

// ---- Keepalive ----
// Firefox MV3 的 background 是 event page，空闲 45-90 秒后会卸载（WebSocket 断开）。
// 用 3 个错峰的 alarms（每 20 秒一个）持续重置 idle timer，保持 background 常驻、桥常连。

browser.alarms.create('keepalive-0', { periodInMinutes: 1 })
setTimeout(() => { browser.alarms.create('keepalive-1', { periodInMinutes: 1 }) }, 20_000)
setTimeout(() => { browser.alarms.create('keepalive-2', { periodInMinutes: 1 }) }, 40_000)
browser.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'bridge-keepalive' || alarm.name?.startsWith('keepalive-')) {
    if (bridge === null || bridge.state === 'reconnecting' || bridge.state === 'stopped') void startBridge()
  }
})

// ---- Boot ----

// Firefox: the sidebar is opened via the toolbar icon / sidebar_action; no sidePanel API.
console.log('[dsh-browser] background script booting, bridgeUrl default:', SETTINGS_DEFAULTS.bridgeUrl)

void loadSettings().then(async (loaded) => {
  settings = loaded
  await startBridge()
}).catch((error) => {
  console.error('[dsh-browser] boot failed:', error)
})
