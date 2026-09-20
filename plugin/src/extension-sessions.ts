/**
 * Track session ids that the browser extension has driven through the bridge.
 * Sessions the extension never touched must keep the host userQuestions
 * waterfall so the dsh web UI (or any other answerer) renders
 * ask_user_question cards.
 * @module
 */

/** Mutable registry of extension-owned session ids. */
export class ExtensionSessionRegistry {
  private readonly ids = new Set<string>()

  /** Remember a session the extension successfully created or prompted. */
  note(sessionId: string | undefined): void {
    if (typeof sessionId === 'string' && sessionId.length > 0) this.ids.add(sessionId)
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
 * Decide whether the bridge should own ask_user_question for this request.
 * All three gates must pass: an extension is connected, that extension
 * advertised question-card support in its hello caps, and the asking session
 * was driven over the bridge. Everything else falls through to `next()` so
 * the native answerer waterfall (dsh web) keeps working.
 */
export function shouldBridgeOwnQuestion(input: {
  hasExtensionConnection: boolean
  clientSupportsQuestions: boolean
  sessionId: string | undefined
  extensionSessions: Pick<ExtensionSessionRegistry, 'has'>
}): boolean {
  return input.hasExtensionConnection
    && input.clientSupportsQuestions
    && input.sessionId !== undefined
    && input.extensionSessions.has(input.sessionId)
}
