/**
 * Pure session-list helpers for the panel: shape the gateway's session and
 * workspace listings into the browser-sessions conversation list, and pick the
 * conversation to resume. No browser.* access — unit-testable without mocks.
 *
 * @module
 */

/** One browser-sessions conversation entry. */
export interface SessionListItem {
  sessionId: string
  title: string
  updatedAt: number
}

/** session/list item (only the fields the panel uses). */
export interface SessionView {
  sessionId: string
  updatedAt: number
  projections?: { values?: { title?: string } }
}

/** workspace/follow item (only the fields the panel uses). */
export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds?: string[]
}

/** workspace/follow stream frame (only the fields the panel uses). */
export interface WorkspaceFollowFrameView {
  type: 'baseline' | 'upsert' | 'remove' | 'order' | 'archived'
  value?: { items: WorkspaceView[] }
  workspace?: WorkspaceView
  workspaceId?: string
  workspaceIds?: string[]
}

/**
 * Reduce the workspace + session listings to the browser-sessions conversations,
 * newest first. Sessions not owned by the browser-sessions workspace are
 * dropped; a missing title is shown as 「新会话」.
 */
export function resolveBrowserSessions(
  workspaces: WorkspaceView[],
  sessions: SessionView[],
): SessionListItem[] {
  const browser = workspaces.find((w) => w.title === 'browser-sessions' || w.path.endsWith('/browser-sessions'))
  const ids = new Set(browser?.sessionIds ?? [])
  return sessions
    .filter((s) => ids.has(s.sessionId))
    .map((s) => ({ sessionId: s.sessionId, title: s.projections?.values?.title ?? '新会话', updatedAt: s.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * Pick the conversation to resume: the persisted id when it still exists,
 * otherwise the newest conversation, otherwise null (empty state).
 */
export function pickCurrentSession(list: SessionListItem[], persistedId: string | null): SessionListItem | null {
  return list.find((s) => s.sessionId === persistedId) ?? list[0] ?? null
}

/** 页面上下文 → 会话 的映射最多保留的条数（LRU 由写入侧整体回写维护）。 */
export const MAX_SESSION_CONTEXTS = 50

/**
 * 页面上下文键：windowId + 页面 origin。同一窗口同一站点重开侧边栏时
 * 恢复上次会话；非网页（about:* 等）返回 null，回退到全局「上次会话」。
 */
export function sessionContextKey(windowId: number | undefined, url: string | undefined): string | null {
  if (windowId === undefined || url === undefined || !/^https?:\/\//.test(url)) return null
  try {
    return `${windowId}|${new URL(url).origin}`
  } catch {
    return null
  }
}

/**
 * 写入一条上下文映射并裁剪到上限：Map 插入序即最近使用序，
 * 重插已有 key 视为 touch。
 */
export function rememberSessionContext(map: Record<string, string>, key: string, sessionId: string): Record<string, string> {
  const entries = Object.entries(map).filter(([k]) => k !== key)
  entries.push([key, sessionId])
  return Object.fromEntries(entries.slice(-MAX_SESSION_CONTEXTS))
}

/**
 * Fold one workspace/follow frame into the cached workspace list (the panel's
 * replacement for the removed `workspace.list` RPC). `archived` frames are
 * ignored: the panel never renders the archive set.
 */
export function applyWorkspaceFrame(items: WorkspaceView[], frame: WorkspaceFollowFrameView): WorkspaceView[] {
  switch (frame.type) {
    case 'baseline':
      return [...(frame.value?.items ?? [])]
    case 'upsert': {
      if (frame.workspace === undefined) return items
      const index = items.findIndex((item) => item.workspaceId === frame.workspace!.workspaceId)
      return index === -1 ? [...items, frame.workspace] : items.map((item, i) => (i === index ? frame.workspace! : item))
    }
    case 'remove':
      return items.filter((item) => item.workspaceId !== frame.workspaceId)
    case 'order': {
      const rank = new Map((frame.workspaceIds ?? []).map((id, index) => [id, index]))
      return [...items].sort((a, b) =>
        (rank.get(a.workspaceId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.workspaceId) ?? Number.MAX_SAFE_INTEGER))
    }
    case 'archived':
      return items
  }
}
