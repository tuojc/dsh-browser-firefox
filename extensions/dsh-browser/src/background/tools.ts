/**
 * Tool dispatch: executes `tool.call` frames in the user's active tab via the
 * content script and answers with the text-only result.
 *
 * Only the active, last-focused window's tab is ever targeted — the bridge
 * never switches tabs or acts in the background.
 *
 * @module
 */

import type { ToolError } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'
import {
  allocateFrameBudgets,
  frameDocumentKey,
  frameOrigin,
  listTabFrames,
  type TabFrame,
} from './frames.ts'

/** A tool call from the bridge. */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
}

/** The wire answer for one tool call. */
export interface ToolAnswer {
  ok: boolean
  result?: unknown
  error?: ToolError
}

/** Snapshot limits negotiated with the bridge and forwarded after lazy injection. */
export interface ContentBudget {
  maxItems: number
  maxChars: number
}

const CONTENT_SCRIPT_FILE = 'content.js'
const pendingInjections = new Map<number, Promise<void>>()
const snapshotDocumentsByTab = new Map<number, Map<number, string>>()

function isToolAnswer(value: unknown): value is ToolAnswer {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { ok?: unknown }).ok === 'boolean'
}

function isInjectablePage(url: string | undefined): boolean {
  return url !== undefined && /^https?:\/\//i.test(url)
}

/** Inject the packaged content script once per tab, coalescing concurrent recovery attempts. */
async function injectContentScript(tabId: number): Promise<void> {
  let pending = pendingInjections.get(tabId)
  if (pending === undefined) {
    pending = chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: [CONTENT_SCRIPT_FILE],
    }).then(() => undefined)
    pendingInjections.set(tabId, pending)
  }
  try {
    await pending
  } finally {
    if (pendingInjections.get(tabId) === pending) pendingInjections.delete(tabId)
  }
}

async function sendAction(tabId: number, call: ToolCall, frameId: number, budget?: ContentBudget): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, {
    type: 'DSH_ACTION',
    action: call.name,
    args: withoutFrame(call.args),
    ...budget === undefined ? {} : { budget },
  }, { frameId })
}

function unavailable(message: string): ToolAnswer {
  return { ok: false, error: { code: 'content-unavailable', message } }
}

function withoutFrame(args: Record<string, unknown>): Record<string, unknown> {
  const { frame: _frame, ...rest } = args
  return rest
}

function requestedFrame(args: Record<string, unknown>): number {
  const value = args.frame
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return -1
  return value
}

function answerText(answer: ToolAnswer): string | undefined {
  if (!answer.ok || typeof answer.result !== 'object' || answer.result === null) return undefined
  const text = (answer.result as { text?: unknown }).text
  return typeof text === 'string' ? text : undefined
}

function capText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const suffix = '\n…(跨 frame 快照已按总预算截断)'
  return `${text.slice(0, Math.max(0, maxChars - suffix.length))}${suffix}`
}

async function snapshotAllFrames(
  tabId: number,
  tabUrl: string | undefined,
  call: ToolCall,
  budget: ContentBudget,
): Promise<ToolAnswer> {
  const frames = await listTabFrames(tabId, tabUrl)
  const budgets = allocateFrameBudgets(frames, budget)
  const previous = snapshotDocumentsByTab.get(tabId) ?? new Map<number, string>()
  const deltaRequested = call.args.delta === true

  const settled = await Promise.allSettled(frames.map(async (frame) => {
    const sameDocument = previous.get(frame.frameId) === frameDocumentKey(frame)
    const frameCall: ToolCall = {
      ...call,
      args: deltaRequested && sameDocument ? call.args : { ...call.args, delta: false },
    }
    const response = await sendAction(tabId, frameCall, frame.frameId, budgets.get(frame.frameId))
    return { frame, response }
  }))

  const sections: string[] = []
  for (let index = 0; index < settled.length; index += 1) {
    const outcome = settled[index]!
    const frame = frames[index]!
    if (outcome.status === 'rejected') {
      if (frame.frameId === 0) throw outcome.reason
      sections.push(frameHeader(frame), '(该 iframe 无法访问或已在加载期间销毁)')
      continue
    }
    const answer = outcome.value.response
    if (!isToolAnswer(answer)) {
      if (frame.frameId === 0) return unavailable('页面内容脚本返回了无效响应')
      sections.push(frameHeader(frame), '(该 iframe 返回了无效响应)')
      continue
    }
    const text = answerText(answer)
    if (text === undefined) {
      if (frame.frameId === 0) return answer
      sections.push(frameHeader(frame), `(该 iframe 读取失败：${answer.error?.message ?? '未知错误'})`)
      continue
    }
    if (frame.frameId === 0) sections.push(text)
    else sections.push(frameHeader(frame), text)
  }

  if (deltaRequested) {
    const liveIds = new Set(frames.map((frame) => frame.frameId))
    const removed = [...previous.keys()].filter((frameId) => frameId !== 0 && !liveIds.has(frameId))
    if (removed.length > 0) sections.push(`\n消失的 iframe: ${removed.join(', ')}`)
  }

  snapshotDocumentsByTab.set(tabId, new Map(frames.map((frame) => [frame.frameId, frameDocumentKey(frame)])))
  return { ok: true, result: { text: capText(sections.join('\n'), budget.maxChars) } }
}

function frameHeader(frame: TabFrame): string {
  return `\n--- iframe frame=${frame.frameId} parent=${frame.parentFrameId} origin=${frameOrigin(frame)} ---`
}

async function dispatchOnce(
  tabId: number,
  tabUrl: string | undefined,
  call: ToolCall,
  budget: ContentBudget,
): Promise<ToolAnswer> {
  if (call.name === 'browser_snapshot') return snapshotAllFrames(tabId, tabUrl, call, budget)

  const frameId = requestedFrame(call.args)
  if (frameId < 0) return { ok: false, error: { code: 'action-failed', message: 'frame 必须是非负整数' } }
  const frames = await listTabFrames(tabId, tabUrl)
  if (!frames.some((frame) => frame.frameId === frameId)) {
    return unavailable(`frame ${frameId} 不存在或已经导航，请重新 browser_snapshot`)
  }
  const response = await sendAction(tabId, call, frameId, budget)
  return isToolAnswer(response) ? response : unavailable('页面内容脚本返回了无效响应')
}

/**
 * Dispatch one tool call to the active tab's content script.
 * @param call - the tool call to execute.
 * @param sharePageContent - the user's page-sharing preference ('off' blocks
 *   every page-content read).
 * @param budget - snapshot limits to restore after on-demand content-script injection.
 * @returns the content script's answer, or a stable error when no tab or
 *   content script is available.
 */
export async function dispatchToolCall(
  call: ToolCall,
  sharePageContent: 'ask' | 'auto' | 'off',
  budget?: ContentBudget,
): Promise<ToolAnswer> {
  // Privacy boundary: with sharing off, no page content may leave the page.
  if (sharePageContent === 'off' && (call.name === 'browser_snapshot' || call.name === 'browser_get_text')) {
    return { ok: false, error: { code: 'action-failed', message: '页面内容共享已关闭（设置 → 页面内容共享）' } }
  }
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
  if (tab?.id === undefined) {
    return { ok: false, error: { code: 'no-active-tab', message: '没有活动的标签页可操作' } }
  }
  const effectiveBudget = budget ?? { maxItems: 60, maxChars: 12_000 }
  try {
    return await dispatchOnce(tab.id, tab.url, call, effectiveBudget)
  } catch {
    // Manifest content scripts do not run retroactively in tabs that were
    // already open when an unpacked extension was installed or reloaded.
    // Recover in place so the user never has to refresh and lose page state.
    if (!isInjectablePage(tab.url)) {
      return unavailable('当前页面不支持浏览器操作；请切换到普通的 http/https 页面')
    }
    try {
      await injectContentScript(tab.id)
      return await dispatchOnce(tab.id, tab.url, call, effectiveBudget)
    } catch {
      return unavailable('无法在当前页面加载内容脚本；Chrome 内置页和受保护页面不支持操作')
    }
  }
}
