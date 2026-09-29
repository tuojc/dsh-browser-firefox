/**
 * Track session ids that the browser extension has driven through the bridge.
 * Sessions the extension never touched must keep the host waterfalls
 * (user-questions, approvals) so the dsh web UI (or any other answerer)
 * renders the cards.
 *
 * Ownership has three sources, all revocable:
 *  - **driven**: the extension created or prompted the session (kept until the
 *    plugin unloads);
 *  - **followed**: an open `session/follow` stream means the sidebar is
 *    displaying that session right now (released when the stream closes);
 *  - **inherited**: an ask from a subagent child session belongs to the
 *    nearest extension-owned ancestor, so child questions/approvals surface in
 *    the parent conversation the user is actually watching.
 *
 * @module
 */

/** Mutable registry of extension-owned session ids. */
export class ExtensionSessionRegistry {
  private readonly ids = new Set<string>()

  /** Remember a session the extension successfully created or prompted. */
  note(sessionId: string | undefined): void {
    if (typeof sessionId === 'string' && sessionId.length > 0) this.ids.add(sessionId)
  }

  /** Forget a session (a failed dispatch revoked an optimistic note). */
  forget(sessionId: string | undefined): void {
    if (typeof sessionId === 'string') this.ids.delete(sessionId)
  }

  /** Whether the extension has touched this session over the bridge. */
  has(sessionId: string | undefined): boolean {
    return typeof sessionId === 'string' && this.ids.has(sessionId)
  }

  /** Test helper: drop all tracked ids. */
  clear(): void {
    this.ids.clear()
  }
}

/**
 * Live `session/follow` subscriptions: the sidebar is displaying these
 * sessions, so they count as extension-owned while the stream is open.
 * Reference-counted per session because one session can be followed by more
 * than one panel connection.
 */
export class FollowedSessions {
  private readonly counts = new Map<string, number>()

  /** Register one open follow stream for a session. */
  open(sessionId: string | undefined): void {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    this.counts.set(sessionId, (this.counts.get(sessionId) ?? 0) + 1)
  }

  /** Release one follow stream; the last release drops the session. */
  close(sessionId: string | undefined): void {
    if (typeof sessionId !== 'string') return
    const current = this.counts.get(sessionId)
    if (current === undefined) return
    if (current <= 1) this.counts.delete(sessionId)
    else this.counts.set(sessionId, current - 1)
  }

  /** Whether any open follow stream is displaying this session. */
  has(sessionId: string | undefined): boolean {
    return typeof sessionId === 'string' && this.counts.has(sessionId)
  }

  /** Drop every subscription (bridge generation replacement, plugin unload). */
  clear(): void {
    this.counts.clear()
  }
}

/** Ownership sources consulted by {@link owningSessionId}. */
export interface OwnershipSources {
  /** Sessions the extension created or prompted. */
  driven: Pick<ExtensionSessionRegistry, 'has'>
  /** Sessions an open follow stream is displaying. */
  followed?: Pick<FollowedSessions, 'has'>
}

/** Maximum ancestor hops when looking for an owned session. */
const MAX_OWNER_DEPTH = 8

/** Whether one exact session id is extension-owned by either source. */
export function isOwnedSession(sessionId: string | undefined, sources: OwnershipSources): boolean {
  if (sessionId === undefined) return false
  return sources.driven.has(sessionId) || sources.followed?.has(sessionId) === true
}

/**
 * Resolve which session id the sidebar card should be filed under: the asking
 * session itself when it is owned, otherwise the nearest owned ancestor (a
 * subagent child session inherits its parent's ownership).
 *
 * @param sessionId - the asking session (the host event's agent id).
 * @param sources - ownership sources.
 * @param parentOf - session-id → parent-session-id lookup; absent disables inheritance.
 * @returns the owned session id to route to, or undefined when nothing owns it.
 */
export function owningSessionId(
  sessionId: string | undefined,
  sources: OwnershipSources,
  parentOf?: (sessionId: string) => string | undefined,
): string | undefined {
  if (sessionId === undefined) return undefined
  if (isOwnedSession(sessionId, sources)) return sessionId
  if (parentOf === undefined) return undefined
  const seen = new Set<string>([sessionId])
  let current = sessionId
  for (let depth = 0; depth < MAX_OWNER_DEPTH; depth += 1) {
    const parent = parentOf(current)
    if (parent === undefined || parent.length === 0 || seen.has(parent)) return undefined
    if (isOwnedSession(parent, sources)) return parent
    seen.add(parent)
    current = parent
  }
  return undefined
}

/** Why a host interaction was delegated to the next answerer. */
export type DelegateReason = 'no-connection' | 'unsupported-client' | 'not-owned'

/** One interaction-ownership decision, kept inspectable for logging and tests. */
export type InteractionOwnership =
  | { owned: true; sessionId: string }
  | { owned: false; reason: DelegateReason }

/**
 * Decide whether the bridge should own one host interaction (question or
 * approval). All gates must pass: an extension is connected, it advertised
 * the matching card capability in its hello caps, and the asking session is
 * extension-owned (directly or through an owned ancestor). Everything else
 * falls through to `next()` so the native answerer waterfall keeps working.
 */
export function resolveInteractionOwnership(input: {
  hasExtensionConnection: boolean
  clientSupports: boolean
  sessionId: string | undefined
  sources: OwnershipSources
  parentOf?: (sessionId: string) => string | undefined
}): InteractionOwnership {
  if (!input.hasExtensionConnection) return { owned: false, reason: 'no-connection' }
  if (!input.clientSupports) return { owned: false, reason: 'unsupported-client' }
  const sessionId = owningSessionId(input.sessionId, input.sources, input.parentOf)
  if (sessionId === undefined) return { owned: false, reason: 'not-owned' }
  return { owned: true, sessionId }
}
