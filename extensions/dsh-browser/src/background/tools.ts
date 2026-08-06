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
      target: { tabId },
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

async function sendAction(tabId: number, call: ToolCall): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, { type: 'DSH_ACTION', action: call.name, args: call.args })
}

function unavailable(message: string): ToolAnswer {
  return { ok: false, error: { code: 'content-unavailable', message } }
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
  try {
    const response = await sendAction(tab.id, call)
    return isToolAnswer(response) ? response : unavailable('页面内容脚本返回了无效响应')
  } catch {
    // Manifest content scripts do not run retroactively in tabs that were
    // already open when an unpacked extension was installed or reloaded.
    // Recover in place so the user never has to refresh and lose page state.
    if (!isInjectablePage(tab.url)) {
      return unavailable('当前页面不支持浏览器操作；请切换到普通的 http/https 页面')
    }
    try {
      await injectContentScript(tab.id)
      if (budget !== undefined) {
        await chrome.tabs.sendMessage(tab.id, { type: 'DSH_BUDGET', budget })
      }
      const response = await sendAction(tab.id, call)
      return isToolAnswer(response) ? response : unavailable('页面内容脚本返回了无效响应')
    } catch {
      return unavailable('无法在当前页面加载内容脚本；Chrome 内置页和受保护页面不支持操作')
    }
  }
}
