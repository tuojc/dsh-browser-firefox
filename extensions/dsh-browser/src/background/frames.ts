/**
 * Frame discovery and budget allocation for one browser tab.
 *
 * Frame ids identify a frame slot and are the routing half of the model-facing
 * `(frame, index)` element address. They can survive navigation, so security
 * checks additionally bind element ids and message delivery to `documentId`.
 * Element ids remain local to each content script, so a re-render in one
 * iframe cannot invalidate otherwise-stable ids in the rest of the page.
 *
 * @module
 */

import type { ContentBudget } from './tools.ts'

/** A live document frame in one tab. Main frame id is always zero. */
export interface TabFrame {
  frameId: number
  parentFrameId: number
  documentId?: string
  url: string
}

/** Per-frame limits whose sum stays close to the negotiated tab budget. */
export interface FrameBudget extends ContentBudget {}

/**
 * Discover all frames, falling back to the main frame when webNavigation is
 * unavailable or the tab is between navigations.
 */
export async function listTabFrames(tabId: number, mainUrl: string | undefined): Promise<TabFrame[]> {
  try {
    const discovered = await chrome.webNavigation.getAllFrames({ tabId })
    if (discovered !== null && discovered !== undefined && discovered.length > 0) {
      return discovered
        .map((frame) => ({
          frameId: frame.frameId,
          parentFrameId: frame.parentFrameId,
          documentId: frame.documentId,
          url: frame.url,
        }))
        .sort((a, b) => frameDepth(a, discovered) - frameDepth(b, discovered) || a.frameId - b.frameId)
    }
  } catch {
    // A main-frame message still gives a useful result while the frame tree is
    // unavailable during a navigation or in older test/browser environments.
  }
  return [{ frameId: 0, parentFrameId: -1, url: mainUrl ?? '' }]
}

function frameDepth(frame: { frameId: number; parentFrameId: number }, frames: Array<{ frameId: number; parentFrameId: number }>): number {
  const parents = new Map(frames.map((candidate) => [candidate.frameId, candidate.parentFrameId]))
  const visited = new Set<number>()
  let depth = 0
  let parent = frame.parentFrameId
  while (parent !== -1 && !visited.has(parent)) {
    visited.add(parent)
    depth += 1
    parent = parents.get(parent) ?? -1
  }
  return depth
}

/** Give the main document most of the budget and divide the rest across frames. */
export function allocateFrameBudgets(frames: TabFrame[], budget: ContentBudget): Map<number, FrameBudget> {
  if (frames.length <= 1) return new Map([[frames[0]?.frameId ?? 0, { ...budget }]])

  const childCount = Math.max(1, frames.length - 1)
  const mainChars = Math.max(1, Math.floor(budget.maxChars * 0.6))
  const mainItems = Math.max(1, Math.floor(budget.maxItems * 0.6))
  const childChars = Math.max(1, Math.floor((budget.maxChars - mainChars) / childCount))
  const childItems = Math.max(1, Math.floor((budget.maxItems - mainItems) / childCount))

  return new Map(frames.map((frame) => [
    frame.frameId,
    frame.frameId === 0
      ? { maxChars: mainChars, maxItems: mainItems }
      : { maxChars: childChars, maxItems: childItems },
  ]))
}

/** A stable key for detecting frame navigation between delta snapshots. */
export function frameDocumentKey(frame: TabFrame): string {
  return frame.documentId ?? frame.url
}

/** Human-readable origin label; unsupported/opaque URLs stay visibly distinct. */
export function frameOrigin(frame: TabFrame): string {
  try {
    return new URL(frame.url).origin
  } catch {
    return frame.url === '' ? '(unknown)' : frame.url
  }
}
