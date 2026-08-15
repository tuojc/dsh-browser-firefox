/** Minimal session.list row needed by the side-panel picker. */
export interface SessionPickerEntry {
  sessionId: string
  updatedAt: number
  running: boolean
  blank: boolean
  cwd?: string
  origin?: 'subagent'
}

/** Only ordinary, started conversations can be resumed through session.prompt. */
export function resumableSessions(items: readonly SessionPickerEntry[]): SessionPickerEntry[] {
  return items.filter((entry) => !entry.blank && entry.origin !== 'subagent')
}

/** A prompt target exists only after the current session transition settles. */
export function sessionAcceptsPrompts(
  connected: boolean,
  changing: boolean,
  sessionId: string | null,
): boolean {
  return connected && !changing && sessionId !== null
}
