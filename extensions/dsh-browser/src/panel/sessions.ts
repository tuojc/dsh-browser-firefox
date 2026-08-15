import type { PendingQuestion, ResolvedQuestion } from './events.ts'
import { removePendingQuestion, upsertPendingQuestion } from './pending-questions.ts'

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

export interface SessionRuntimeSnapshot {
  running: boolean
  questions: PendingQuestion[]
}

interface StoredSessionRuntime {
  running?: boolean
  questions: PendingQuestion[]
}

/** Live, per-session state that session.history cannot reconstruct. */
export class SessionRuntimeCache {
  private readonly sessions = new Map<string, StoredSessionRuntime>()

  rememberQuestion(question: PendingQuestion): void {
    const current = this.sessions.get(question.sessionId) ?? { questions: [] }
    this.sessions.set(question.sessionId, {
      ...current,
      questions: upsertPendingQuestion(current.questions, question),
    })
  }

  resolveQuestion(question: ResolvedQuestion): void {
    const current = this.sessions.get(question.sessionId)
    if (current === undefined) return
    this.sessions.set(question.sessionId, {
      ...current,
      questions: removePendingQuestion(current.questions, question),
    })
  }

  seedRunning(sessionId: string, running: boolean): void {
    const current = this.sessions.get(sessionId) ?? { questions: [] }
    if (current.running !== undefined) return
    this.sessions.set(sessionId, { ...current, running })
  }

  startTurn(sessionId: string): void {
    const current = this.sessions.get(sessionId) ?? { questions: [] }
    this.sessions.set(sessionId, { ...current, running: true })
  }

  finishTurn(sessionId: string): void {
    this.sessions.set(sessionId, { running: false, questions: [] })
  }

  snapshot(sessionId: string, fallbackRunning = false): SessionRuntimeSnapshot {
    const current = this.sessions.get(sessionId)
    return {
      running: current?.running ?? fallbackRunning,
      questions: current?.questions.slice() ?? [],
    }
  }

  clear(): void {
    this.sessions.clear()
  }
}
