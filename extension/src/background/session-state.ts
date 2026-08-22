/**
 * Per-session tab state: which tab a dsh session is working on, which Firefox
 * tab group it owns, and the stack of tabs it opened (for browser_back and
 * browser_list_tabs).
 *
 * Pure module — no browser.* API access — so the session-switching, tab
 * cleanup, and group-invalidation rules are unit-testable without mocks.
 *
 * @module
 */

/** Tab state owned by one dsh session (or the anonymous default session). */
export interface SessionTabState {
  /** The session's working tab (background tab opened by navigate/link-click). */
  workingTabId?: number
  /** The Firefox tab group this session's tabs belong to. */
  groupId?: number
  /** Opened-tab order (deduped, most recent last) for back/list. */
  tabStack: number[]
}

function emptyState(): SessionTabState {
  return { tabStack: [] }
}

/** Key for the anonymous session (tool calls without a sessionId). */
const ANONYMOUS = ''

/**
 * Tracks tab state per dsh session. Switching sessions never discards the
 * other sessions' state: returning to a session restores its working tab,
 * group, and tab stack exactly as they were left.
 */
export class TabSessionManager {
  private readonly sessions = new Map<string, SessionTabState>()
  private currentKey = ANONYMOUS

  /**
   * Make `sessionId` the current session and return its state, creating a
   * fresh state on first sight. State of other sessions is preserved.
   * @param sessionId - dsh session id, or undefined for the anonymous session.
   * @returns the session's (mutable) tab state.
   */
  ensure(sessionId: string | undefined): SessionTabState {
    const key = sessionId ?? ANONYMOUS
    this.currentKey = key
    let state = this.sessions.get(key)
    if (state === undefined) {
      state = emptyState()
      this.sessions.set(key, state)
    }
    return state
  }

  /** @returns the current session's state (created on demand). */
  current(): SessionTabState {
    return this.ensure(this.currentKey === ANONYMOUS ? undefined : this.currentKey)
  }

  /**
   * Forget a tab everywhere: it closed or is otherwise gone. Clears working
   * tab references and drops the id from every stack.
   * @param tabId - the closed tab id.
   */
  removeTab(tabId: number): void {
    for (const state of this.sessions.values()) {
      if (state.workingTabId === tabId) state.workingTabId = undefined
      state.tabStack = state.tabStack.filter((id) => id !== tabId)
    }
  }

  /**
   * Forget a session's group id (e.g. the group died because its last tab
   * closed). The next tab creation starts a fresh group for the session.
   * @param sessionId - owning session, or undefined for anonymous.
   */
  clearGroup(sessionId: string | undefined): void {
    const state = this.sessions.get(sessionId ?? ANONYMOUS)
    if (state !== undefined) state.groupId = undefined
  }

  /** @returns the group id recorded for a session, if any. */
  groupOf(sessionId: string | undefined): number | undefined {
    return this.sessions.get(sessionId ?? ANONYMOUS)?.groupId
  }
}

/**
 * Push a tab onto a stack, deduped, most recent last.
 * @param stack - the stack to mutate.
 * @param tabId - tab to push.
 */
export function pushTab(stack: number[], tabId: number): void {
  const next = stack.filter((id) => id !== tabId)
  next.push(tabId)
  stack.length = 0
  stack.push(...next)
}
