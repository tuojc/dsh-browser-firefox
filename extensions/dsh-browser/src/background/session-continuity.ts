import type { ServerFrame } from '@yuxianglin/dsh-bridge-browser/src/protocol.ts'

export const RECENT_SESSION_STORAGE_KEY = 'dshRecentBrowserSession'

interface RecentSessionStorage {
  read: () => Promise<unknown>
  write: (sessionId: string) => Promise<void>
}

/** Persist the latest browser conversation across panel and worker lifetimes. */
export class RecentSessionTracker {
  private sessionId: string | null = null
  private readonly browserSessionIds = new Set<string>()
  private revision = 0
  private persistence = Promise.resolve()
  readonly ready: Promise<void>

  constructor(private readonly storage: RecentSessionStorage) {
    this.ready = this.restore()
  }

  remember(value: unknown): boolean {
    const sessionId = normalizeSessionId(value)
    if (sessionId === undefined) return false
    this.browserSessionIds.add(sessionId)
    return this.setCurrent(sessionId)
  }

  /** Record activity only when the session was already claimed by this browser. */
  noteActivity(value: unknown): boolean {
    const sessionId = normalizeSessionId(value)
    if (sessionId === undefined || !this.browserSessionIds.has(sessionId)) return false
    return this.setCurrent(sessionId)
  }

  private setCurrent(sessionId: string): boolean {
    if (sessionId === this.sessionId) return false
    this.revision += 1
    this.sessionId = sessionId
    this.persistence = this.persistence.catch(() => {}).then(async () => {
      await this.storage.write(sessionId)
    }).catch(() => {})
    return true
  }

  current(): string | null {
    return this.sessionId
  }

  private async restore(): Promise<void> {
    const revision = this.revision
    try {
      const sessionId = normalizeSessionId(await this.storage.read())
      if (this.revision === revision && sessionId !== undefined) {
        this.browserSessionIds.add(sessionId)
        this.sessionId = sessionId
      }
    } catch {
      // Session continuity is best effort; a storage failure still permits a new chat.
    }
  }
}

/** Read a session activity candidate from a live session-scoped event frame. */
export function sessionIdFromFrame(frame: ServerFrame): string | undefined {
  if (frame.t !== 'event'
    || (frame.frame.method !== 'session/event' && frame.frame.method !== 'question/requested')
    || typeof frame.frame.payload !== 'object'
    || frame.frame.payload === null) return undefined
  return normalizeSessionId((frame.frame.payload as Record<string, unknown>).sessionId)
}

function normalizeSessionId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}
