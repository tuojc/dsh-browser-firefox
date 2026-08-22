/**
 * Content script entry: listens for DSH_ACTION messages from the background
 * service worker, runs the action against the real page, and answers with a
 * text-only result. Starts the DOM watcher that marks the snapshot dirty.
 *
 * The content script is the only part that touches the page; the bridge and
 * the model never see page internals beyond the structured text snapshots.
 *
 * @module
 */

import { runAction, ActionError } from './actions.ts'
import { ElementIds } from './ids.ts'
import type { SnapshotBudget } from './snapshot.ts'

/** Negotiated snapshot budgets, patched in from the background via message. */
let budget: SnapshotBudget = { maxItems: 60, maxForms: 30, maxChars: 12_000 }

const ids = new ElementIds()

/** 页面卸载后，响应端口已断开，不再 sendResponse（避免 Firefox 的 postMessage on disconnected port）。 */
let pageUnloading = false
window.addEventListener('pagehide', () => { pageUnloading = true })

/** 安全发送响应：页面卸载或端口断开时静默跳过。 */
function safeSend(sendResponse: (response: ToolResult) => void, response: ToolResult): void {
  if (pageUnloading) return
  try { sendResponse(response) } catch { /* 端口已断开 */ }
}

const CONTENT_SCRIPT_LISTENER = '__dshBrowserContentScriptListener__'
type ContentListener = typeof onMessage

/** A tool-call result for the bridge. */
export interface ToolResult {
  ok: boolean
  result?: { text: string }
  error?: { code: string; message: string }
}

function onMessage(message: unknown, _sender: chrome.runtime.MessageSender, sendResponse: (response: ToolResult) => void): true | undefined {
  if (typeof message !== 'object' || message === null) return
  const msg = message as { type?: string }
  if (msg.type === 'DSH_BUDGET') {
    const incoming = (message as { budget?: Partial<SnapshotBudget> }).budget
    if (incoming !== undefined) {
      budget = { ...budget, ...incoming }
      safeSend(sendResponse, { ok: true, result: { text: `快照预算已更新: ${JSON.stringify(budget)}` } })
    }
    return
  }
  if (msg.type === 'DSH_RESOLVE_ELEMENT') {
    const index = (message as { index?: unknown }).index
    if (typeof index === 'number') {
      const el = ids.elementByIndex(index)
      if (el instanceof HTMLAnchorElement && typeof el.href === 'string'
        && (el.href.startsWith('http://') || el.href.startsWith('https://'))) {
        safeSend(sendResponse, { isLink: true, href: el.href } as unknown as ToolResult)
      } else {
        safeSend(sendResponse, { isLink: false } as unknown as ToolResult)
      }
    } else {
      safeSend(sendResponse, { isLink: false } as unknown as ToolResult)
    }
    return
  }
  if (msg.type !== 'DSH_ACTION') return
  const actionMsg = message as { action?: string; args?: Record<string, unknown> }
  const action = actionMsg.action ?? ''
  const args = actionMsg.args ?? {}
  void runAction(action, args, { ids, budget }).then(
    (result) => { safeSend(sendResponse, { ok: true, result }) },
    (error: unknown) => {
      const code = error instanceof ActionError ? error.code : 'action-failed'
      const messageText = error instanceof Error ? error.message : String(error)
      safeSend(sendResponse, { ok: false, error: { code, message: messageText } })
    },
  )
  return true // async response
}

// executeScript is used to recover tabs opened before extension install/reload.
// Replace any stale listener left in the isolated world so a reload always
// installs a listener belonging to the current extension context.
const contentGlobal = globalThis as typeof globalThis & { [CONTENT_SCRIPT_LISTENER]?: ContentListener }
const previousListener = contentGlobal[CONTENT_SCRIPT_LISTENER]
if (previousListener !== undefined) {
  try { browser.runtime.onMessage.removeListener(previousListener) } catch { /* stale extension context */ }
}
contentGlobal[CONTENT_SCRIPT_LISTENER] = onMessage
browser.runtime.onMessage.addListener(onMessage)
