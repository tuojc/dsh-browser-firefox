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

/** session.list item (only the fields the panel uses). */
export interface SessionView {
  sessionId: string
  updatedAt: number
  projections?: { values?: { title?: string } }
}

/** workspace.list item (only the fields the panel uses). */
export interface WorkspaceView {
  workspaceId: string
  path: string
  title: string
  sessionIds?: string[]
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
