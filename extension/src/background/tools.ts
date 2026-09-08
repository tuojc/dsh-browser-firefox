/**
 * Tool dispatch: executes `tool.call` frames in the user's active tab via the
 * content script and answers with the text-only result.
 *
 * Only the active, last-focused window's tab is ever targeted — the bridge
 * never switches tabs or acts in the background.
 *
 * @module
 */

import type { ToolError } from 'dsh-browser-firefox/src/protocol.ts'
import { waitForTabComplete } from './tab-utils.ts'

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

/** Inject the packaged content script once per tab/frame, coalescing concurrent recovery attempts. */
async function injectContentScript(tabId: number, frameId = 0): Promise<void> {
  const key = tabId * 1_000_003 + frameId
  let pending = pendingInjections.get(key)
  if (pending === undefined) {
    pending = browser.scripting.executeScript({
      target: frameId === 0 ? { tabId } : { tabId, frameIds: [frameId] },
      files: [CONTENT_SCRIPT_FILE],
    }).then(() => undefined)
    pendingInjections.set(key, pending)
  }
  try {
    await pending
  } finally {
    if (pendingInjections.get(key) === pending) pendingInjections.delete(key)
  }
}

async function sendAction(tabId: number, call: ToolCall, frameId = 0): Promise<unknown> {
  // 始终显式指定 frame：iframe 里也可能注入了 content script，缺省会多帧竞争响应。
  return browser.tabs.sendMessage(tabId, { type: 'DSH_ACTION', action: call.name, args: call.args }, { frameId })
}

function unavailable(message: string): ToolAnswer {
  return { ok: false, error: { code: 'content-unavailable', message } }
}

/** 导航后自动附的快照渲染上限：建立 delta 基线是主要目的，文本压缩到够用即可。 */
const AUTO_SNAPSHOT_MAX_CHARS = 2_000

/** iframe 聚合：主帧占 80% 预算，子帧合计 20%。 */
const MAIN_FRAME_SHARE = 0.8
/** 一次快照最多聚合的子帧数（防嵌套页面爆炸）。 */
const MAX_AGGREGATED_FRAMES = 4
/** 单个子帧的最小字符预算（太小没有信息量）。 */
const MIN_FRAME_CHARS = 400

/**
 * 导航类动作后自动抓一份目标 tab 的快照文本（同时在该 tab 建立 delta 基线，
 * 之后同 tab 的动作就能附增量）。页面不支持注入时静默跳过。
 * @param tabId - 目标 tab。
 * @param budget - 协商的快照预算（注入恢复时用）。
 * @returns 快照文本（超长截断），失败为 undefined。
 */
export async function snapshotTabAfterNavigation(
  tabId: number,
  budget?: ContentBudget,
): Promise<string | undefined> {
  const answer = await dispatchToolCall(
    { id: 'auto-snapshot', name: 'browser_snapshot', args: {} },
    budget,
    tabId,
  )
  if (!answer.ok) return undefined
  const text = (answer.result as { text?: unknown } | undefined)?.text
  if (typeof text !== 'string') return undefined
  return text.length <= AUTO_SNAPSHOT_MAX_CHARS
    ? text
    : `${text.slice(0, AUTO_SNAPSHOT_MAX_CHARS)}…(自动快照已截断，完整版请调用 browser_snapshot)`
}

/**
 * browser_snapshot 的 iframe 聚合版：主帧快照占 80% 预算，每个子帧（按需注入
 * content script）分到剩余预算的等份，渲染成独立小节附在后面。子帧内元素的
 * 编号只在对应 frame 内有效，模型操作用 `frame` 参数定位。
 *
 * @param call - browser_snapshot 调用（args 原样透传给各帧）。
 * @param budget - 协商的总预算（主帧/子帧按比例切分）。
 * @param tabId - 目标 tab。
 * @returns 聚合后的快照文本。
 */
export async function dispatchAggregatedSnapshot(
  call: ToolCall,
  budget: ContentBudget | undefined,
  tabId: number | undefined,
): Promise<ToolAnswer> {
  const mainBudget = budget === undefined ? undefined : {
    maxItems: Math.max(10, Math.floor(budget.maxItems * MAIN_FRAME_SHARE)),
    maxChars: Math.max(MIN_FRAME_CHARS, Math.floor(budget.maxChars * MAIN_FRAME_SHARE)),
  }
  const mainCall: ToolCall = mainBudget === undefined
    ? call
    : { ...call, args: { ...call.args, budget: { ...mainBudget, maxForms: 30 } } }
  const main = await dispatchToolCall(mainCall, mainBudget, tabId, 0)
  if (!main.ok) return main
  const resolvedTab = tabId ?? (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id
  if (resolvedTab === undefined) return main
  const frames = await browser.webNavigation.getAllFrames({ tabId: resolvedTab }).catch(() => undefined)
  const children = (frames ?? [])
    .filter((frame) => frame.frameId !== 0 && /^https?:\/\//.test(frame.url))
    .slice(0, MAX_AGGREGATED_FRAMES)
  if (children.length === 0) return main
  const frameShare = (1 - MAIN_FRAME_SHARE) / children.length
  const frameBudget = budget === undefined ? undefined : {
    maxItems: Math.max(5, Math.floor(budget.maxItems * frameShare)),
    maxChars: Math.max(MIN_FRAME_CHARS, Math.floor(budget.maxChars * frameShare)),
  }
  const sections: string[] = []
  for (const frame of children) {
    try {
      await injectContentScript(resolvedTab, frame.frameId)
      if (frameBudget !== undefined) {
        await browser.tabs.sendMessage(resolvedTab, { type: 'DSH_BUDGET', budget: frameBudget }, { frameId: frame.frameId })
      }
      const response = await browser.tabs.sendMessage(resolvedTab, {
        type: 'DSH_ACTION',
        action: 'browser_snapshot',
        args: { ...call.args, budget: { ...frameBudget, maxForms: 10 } },
      }, { frameId: frame.frameId })
      if (isToolAnswer(response) && response.ok) {
        const text = (response.result as { text?: unknown } | undefined)?.text
        if (typeof text === 'string' && text !== '') {
          sections.push(`\n\n--- iframe #${frame.frameId} (${frame.url}) ---\n${text}\n（该 iframe 内元素的编号仅在本 iframe 内有效；操作它们时给工具传 frame: ${frame.frameId}）`)
        }
      }
    } catch {
      // 跨源注入被拒 / frame 已消失：跳过该帧，不影响主帧结果。
    }
  }
  const mainText = (main.result as { text?: unknown } | undefined)?.text
  return { ok: true, result: { text: `${typeof mainText === 'string' ? mainText : ''}${sections.join('')}` } }
}

/**
 * Dispatch one tool call to the active tab's content script.
 * @param call - the tool call to execute.
 * @param budget - snapshot limits to restore after on-demand content-script injection.
 * @returns the content script's answer, or a stable error when no tab or
 *   content script is available.
 */
export async function dispatchToolCall(
  call: ToolCall,
  budget?: ContentBudget,
  tabId?: number,
  frameId = 0,
): Promise<ToolAnswer> {
  // 优先用「工作 tab」（navigate/点击链接新建的 tab，静默操作）；
  // 若工作 tab 已关闭（失效），回退到当前活动 tab。
  let tab: chrome.tabs.Tab | undefined
  if (tabId !== undefined) {
    tab = await browser.tabs.get(tabId).catch(() => undefined)
  }
  if (tab === undefined) {
    tab = (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]
  }
  if (tab?.id === undefined) {
    return { ok: false, error: { code: 'no-active-tab', message: '没有可操作的标签页' } }
  }
  // 后台标签页可能被 Firefox 卸载（discarded）或仍在加载：注入内容脚本前先确保页面就绪。
  if (tab.discarded === true) {
    await browser.tabs.reload(tab.id).catch(() => {})
    await waitForTabComplete(tab.id)
  } else if (tab.status === 'loading') {
    await waitForTabComplete(tab.id)
  }
  try {
    const response = await sendAction(tab.id, call, frameId)
    return isToolAnswer(response) ? response : unavailable('页面内容脚本返回了无效响应')
  } catch {
    // Manifest content scripts do not run retroactively in tabs that were
    // already open when an unpacked extension was installed or reloaded.
    // Recover in place so the user never has to refresh and lose page state.
    if (!isInjectablePage(tab.url)) {
      return unavailable('当前页面不支持浏览器操作；请切换到普通的 http/https 页面')
    }
    try {
      await injectContentScript(tab.id, frameId)
      if (budget !== undefined) {
        await browser.tabs.sendMessage(tab.id, { type: 'DSH_BUDGET', budget }, { frameId })
      }
      const response = await sendAction(tab.id, call, frameId)
      return isToolAnswer(response) ? response : unavailable('页面内容脚本返回了无效响应')
    } catch (cause) {
      console.error('[dsh-browser] content script injection failed:', cause)
      const reason = cause instanceof Error ? cause.message : String(cause)
      return unavailable(`无法在当前页面加载内容脚本（${reason}）。页面可能刚被浏览器卸载或仍在加载，请稍后重试。`)
    }
  }
}
