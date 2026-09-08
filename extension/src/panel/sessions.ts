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
