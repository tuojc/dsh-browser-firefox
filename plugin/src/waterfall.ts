/**
 * Bookkeeping shared by the host waterfalls the bridge claims
 * (`user-questions/request`, `approval/request`).
 *
 * Both bridges need exactly the same lifecycle: one pending entry per
 * generated id, a **single settlement** guarantee against concurrent paths
 * (extension answer vs host abort vs connection loss vs plugin unload), an
 * abort listener that is detached once settled, and the id+session match the
 * uplink must pass before it may touch an entry. Only the outcome vocabulary
 * and the push/settle policy differ, and those stay in the domain modules.
 *
 * @module
 */

interface Entry<TOutcome, TPayload> {
  readonly sessionId: string
  /** Domain state the uplink needs (e.g. the question ids one card asked about). */
  readonly payload: TPayload
  /** Domain policy for one settlement; invoked at most once per id. */
  readonly complete: (outcome: TOutcome) => void
  readonly signal: AbortSignal | undefined
  readonly onAbort: (() => void) | undefined
  settled: boolean
}

/** Registry of pending waterfall requests, keyed by the id sent to the extension. */
export class PendingWaterfalls<TOutcome, TPayload = undefined> {
  private readonly entries = new Map<string, Entry<TOutcome, TPayload>>()

  /**
   * Track one request pushed to the extension.
   *
   * @param input - id, asking session, host cancellation signal, the domain's
   *   settlement policy, and the abort handler (typically: tell the extension
   *   the card is gone, then settle).
   */
  register(input: {
    id: string
    sessionId: string
    signal: AbortSignal | undefined
    payload: TPayload
    complete: (outcome: TOutcome) => void
    onAbort: () => void
  }): void {
    const entry: Entry<TOutcome, TPayload> = {
      sessionId: input.sessionId,
      payload: input.payload,
      complete: input.complete,
      signal: input.signal,
      onAbort: input.onAbort,
      settled: false,
    }
    if (input.signal !== undefined) input.signal.addEventListener('abort', input.onAbort, { once: true })
    this.entries.set(input.id, entry)
  }

  /**
   * Whether an unsettled entry exists for exactly this id and session. The
   * uplink must not be able to settle another session's card.
   */
  matches(id: string, sessionId: string): boolean {
    const entry = this.entries.get(id)
    return entry !== undefined && !entry.settled && entry.sessionId === sessionId
  }

  /** Domain payload registered with one unsettled entry (undefined once settled). */
  payloadOf(id: string): TPayload | undefined {
    return this.entries.get(id)?.payload
  }

  /**
   * Settle one request. Later settlements for the same id are no-ops, and the
   * entry is dropped together with its abort listener.
   *
   * @returns true when this call performed the settlement.
   */
  settle(id: string, outcome: TOutcome): boolean {
    const entry = this.entries.get(id)
    if (entry === undefined || entry.settled) return false
    entry.settled = true
    this.entries.delete(id)
    if (entry.onAbort !== undefined) entry.signal?.removeEventListener('abort', entry.onAbort)
    entry.complete(outcome)
    return true
  }

  /** Every unsettled id, for the connection-loss and unload sweeps. */
  ids(): string[] {
    return [...this.entries.keys()]
  }
}
