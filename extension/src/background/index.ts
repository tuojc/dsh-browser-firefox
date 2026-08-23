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

import type { BridgeCaps } from 'dsh-browser-firefox/src/protocol.ts'
import type { ServerFrame } from 'dsh-browser-firefox/src/protocol.ts'
import { BRIDGE_CONFIG_PATH, BRIDGE_PATH } from 'dsh-browser-firefox/src/protocol.ts'
import { BridgeClient, type BridgeState } from './bridge.ts'
import { createRpc } from './rpc.ts'
import { dispatchToolCall, type ToolCall, type ToolAnswer, type ContentBudget } from './tools.ts'
import { TabSessionManager, pushTab } from './session-state.ts'
import { waitForTabComplete } from './tab-utils.ts'
import { registerToolbarAction, type SidebarActionApi } from './toolbar.ts'

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

/** Per-session tab state (working tab / group / tab stack). */
const tabSessions = new TabSessionManager()

/** 切换当前 session 并返回其 tab 状态；其它 session 的状态原样保留。 */
function ensureSession(sessionId: string | undefined): void {
  tabSessions.ensure(sessionId)
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
  const state = tabSessions.current()
  state.workingTabId = tab.id
  if (tab.id !== undefined) pushTab(state.tabStack, tab.id)
  if (tab.id === undefined || sessionId === undefined) return tab
  try {
    const existing = tabSessions.groupOf(sessionId)
    if (existing !== undefined) {
      try {
        state.groupId = await browser.tabs.group({ tabIds: [tab.id], groupId: existing })
        return tab
      } catch {
        // 记录的 group 已失效（用户关掉了组内所有 tab）：删映射，按新建 group 重试。
        tabSessions.clearGroup(sessionId)
      }
    }
    const groupId = await browser.tabs.group({ tabIds: [tab.id], createProperties: { windowId: tab.windowId } })
    state.groupId = groupId
    const color = GROUP_COLORS[groupColorIndex++ % GROUP_COLORS.length]
    const groupTitle = title || titleFromUrl(url)
    try {
      await browser.tabGroups.update(groupId, { color, title: groupTitle })
    } catch (error) { console.warn('[dsh-browser] tab group color/title failed:', error) }
  } catch (error) {
    // tabGroups 不可用（如更旧的 Firefox）时降级：tab 已创建，只是未分组。
    console.warn('[dsh-browser] tab group failed (tab 仍已创建，仅未分组):', error)
  }
  return tab
}

/** browser_navigate：新建标签页打开（不覆盖当前页），并归入当前会话的 group。 */
/** browser_screenshot：截取工作 tab（或活动 tab）为 data URL，回传 bridge 保存。 */
async function screenshotAction(): Promise<ToolAnswer> {
  const targetId = tabSessions.current().workingTabId
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
    tabSessions.current().workingTabId = existing.id
    return { ok: true, result: { text: `已切换到已有标签页 ${parsed.href}…` } }
  }
  // 2. 否则新建并等待加载完成（紧接着的 snapshot 需要完整 DOM）
  const tab = await createTabInGroup(parsed.href, sessionId, title)
  if (tab.id !== undefined) await waitForTabComplete(tab.id)
  return { ok: true, result: { text: `已在后台新标签页打开 ${parsed.href}…` } }
}

/** 在当前 session group 里查找「相同页面（origin+pathname+search，忽略 hash）」的 tab。 */
async function findTabByPage(url: string): Promise<chrome.tabs.Tab | undefined> {
  // 还没建 group 时不检测，直接新建 + 建 group，避免切到用户没关的 tab
  const groupId = tabSessions.current().groupId
  if (groupId === undefined) return undefined
  const target = new URL(url)
  const tabs = await browser.tabs.query({})
  return tabs.find((t) => {
    // 只查当前 session 的 group
    if (t.groupId !== groupId) return false
    if (t.url === undefined || !/^https?:\/\//.test(t.url)) return false
    try {
      const u = new URL(t.url)
      return u.origin === target.origin && u.pathname === target.pathname && u.search === target.search
    } catch { return false }
  })
}

/** browser_click：先让 content script 解析目标元素；若是链接则新建标签页 + 入 group，否则普通点击。 */
async function clickAction(call: ToolCall, sessionId: string | undefined, budget: ContentBudget | undefined, title?: string): Promise<ToolAnswer> {
  // 快照编号来自工作 tab：优先在工作 tab 上解析目标元素，失效时回退活动 tab。
  const state = tabSessions.current()
  let tab = state.workingTabId === undefined
    ? undefined
    : await browser.tabs.get(state.workingTabId).catch(() => undefined)
  tab ??= (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
  if (tab?.id === undefined) {
    return { ok: false, error: { code: 'no-active-tab', message: '没有活动的标签页可操作' } }
  }
  try {
    const info = await browser.tabs.sendMessage(tab.id, { type: 'DSH_RESOLVE_ELEMENT', index: call.args.index })
    const resolved = info as { isLink?: boolean; href?: string } | undefined
    if (resolved?.isLink === true && typeof resolved.href === 'string') {
      const parsed = safeHttpUrl(resolved.href)
      if (parsed !== undefined) {
        const opened = await createTabInGroup(parsed.href, sessionId, title)
        if (opened.id !== undefined) await waitForTabComplete(opened.id)
        return { ok: true, result: { text: `已在后台新标签页打开 ${parsed.href}…` } }
      }
    }
  } catch {
    // content script 未就绪或解析失败：回退到普通 dispatch（会触发注入恢复）。
  }
  return dispatchToolCall(call, settings.sharePageContent, budget, state.workingTabId)
}

/** browser_back：栈中有上一个 tab 时切回，栈底退化到页面 history.back()。 */
async function backAction(call: ToolCall, budget: ContentBudget | undefined): Promise<ToolAnswer> {
  const state = tabSessions.current()
  const idx = state.tabStack.lastIndexOf(state.workingTabId ?? -1)
  if (idx > 0) {
    state.workingTabId = state.tabStack[idx - 1]
    return { ok: true, result: { text: '已回到上一个标签页' } }
  }
  return dispatchToolCall(call, settings.sharePageContent, budget, state.workingTabId)
}

/** browser_list_tabs：列出当前 session group 的所有 tab。 */
async function listTabsAction(): Promise<ToolAnswer> {
  const state = tabSessions.current()
  const tabs = await browser.tabs.query({})
  const items = tabs
    .filter((t) => state.groupId === undefined || t.groupId === state.groupId)
    .map((t) => {
      const mark = t.id === state.workingTabId ? ' *' : ''
      return `[${t.id}]${mark} ${t.title ?? '(无标题)'} ${t.url ?? ''}`
    })
  return { ok: true, result: { text: items.length > 0 ? items.join('\n') : '(无标签页)' } }
}

/** In-flight tool calls that a bridge tool.cancel can still withdraw. */
const inflightToolCalls = new Map<string, { cancelled: boolean }>()

/** Route one tool.call frame to the active tab and answer over the bridge. */
function routeToolCall(call: ToolCall, expiresAt: number | undefined, sessionId: string | undefined, title: string | undefined): void {
  if (bridge === null) return
  // 到达时已过期的调用直接拒绝：不再执行任何页面动作。
  if (expiresAt !== undefined && Date.now() > expiresAt) {
    bridge.send({ t: 'tool.result', id: call.id, ok: false, error: { code: 'timeout', message: '调用到达时已过期，未执行' } })
    return
  }
  const state = { cancelled: false }
  inflightToolCalls.set(call.id, state)
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
    promise = dispatchToolCall(call, settings.sharePageContent, budget, tabSessions.current().workingTabId)
  }
  void promise.then((answer) => {
    inflightToolCalls.delete(call.id)
    // 调用方已超时/取消（server 已 tool.cancel 并在本地结算）：
    // 迟到的结果直接丢弃，过期动作不能被记为成功。
    if (state.cancelled) return
    sendAnswer(answer)
  })
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
        else if (frame.t === 'tool.call') routeToolCall(frame, frame.expiresAt, frame.sessionId, frame.title)
        else if (frame.t === 'tool.cancel') {
          const entry = inflightToolCalls.get(frame.id)
          if (entry !== undefined) entry.cancelled = true
        }
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
  const state = tabSessions.current()
  state.workingTabId = tab.id
  pushTab(state.tabStack, tab.id)
  if (state.groupId !== undefined) {
    void browser.tabs.group({ tabIds: [tab.id], groupId: state.groupId }).catch(() => {})
  }
}

browser.tabs.onCreated.addListener((tab) => {
  if (tab.openerTabId !== undefined) {
    if (tab.openerTabId === tabSessions.current().workingTabId) followTab(tab)
  } else if (tab.id !== undefined) {
    pendingFollowTabs.add(tab.id)
  }
})

// tab 关闭时清理：所有 session 的栈剔除死 id、工作 tab 引用置空。
browser.tabs.onRemoved.addListener((tabId) => {
  pendingFollowTabs.delete(tabId)
  tabSessions.removeTab(tabId)
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

// ---- Toolbar action → sidebar ----
// Firefox 的顶部工具栏 action 图标默认无任何点击行为：不注册 onClicked 的话，
// 安装后顶部图标只是摆设，只有 sidebar_action 侧边栏入口能打开面板。
// 这里注册 action.onClicked → sidebarAction.toggle()，让顶部图标也能打开/收起侧边栏。
// sidebarAction 是 Firefox 专有 API（@types/chrome 未收录），用窄化类型接入。
registerToolbarAction(
  browser.action,
  (browser as unknown as { sidebarAction: SidebarActionApi }).sidebarAction,
)

// ---- Boot ----

// Firefox: 用 sidebar_action 打开侧边栏面板（无 sidePanel API）；顶部工具栏图标也在此处接入。
console.log('[dsh-browser] background script booting, bridgeUrl default:', SETTINGS_DEFAULTS.bridgeUrl)

void loadSettings().then(async (loaded) => {
  settings = loaded
  await startBridge()
}).catch((error) => {
  console.error('[dsh-browser] boot failed:', error)
})
