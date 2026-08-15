import type { ServerFrame } from '@deepseek-ai/dsh-bridge-browser/src/protocol.ts'

type ResponseReceipt = Extract<ServerFrame, { t: 'respond.result' }>

/** Minimal panel-port surface needed for targeted interaction receipts. */
export interface ResponsePort {
  postMessage(message: unknown): void
}

interface PendingResponse {
  port: ResponsePort
  timer: ReturnType<typeof setTimeout>
}

/**
 * Correlates one interaction response with the panel that sent it. Receipts
 * must never be broadcast: separate side panels can answer at the same time.
 */
export class InteractionResponseRouter {
  private readonly pending = new Map<string, PendingResponse>()

  constructor(private readonly timeoutMs = 30_000) {}

  begin(
    port: ResponsePort,
    id: string,
    dispatch: () => boolean,
    messages: { unavailable: string; timeout: string; duplicate: string },
  ): void {
    if (this.pending.has(id)) {
      this.postError(port, id, 'duplicate-id', messages.duplicate)
      return
    }
    const timer = setTimeout(() => {
      const entry = this.take(id)
      if (entry !== undefined) this.postError(entry.port, id, 'timeout', messages.timeout)
    }, this.timeoutMs)
    this.pending.set(id, { port, timer })
    if (!dispatch()) {
      const entry = this.take(id)
      if (entry !== undefined) this.postError(entry.port, id, 'bridge-unavailable', messages.unavailable)
    }
  }

  route(receipt: ResponseReceipt): void {
    const entry = this.take(receipt.id)
    if (entry === undefined) return
    try {
      entry.port.postMessage(receipt.ok
        ? { type: 'respond.result', id: receipt.id, ok: true, result: receipt.result }
        : { type: 'respond.result', id: receipt.id, ok: false, error: receipt.error })
    } catch { /* panel already closed */ }
  }

  failAll(message: string): void {
    for (const id of [...this.pending.keys()]) {
      const entry = this.take(id)
      if (entry !== undefined) this.postError(entry.port, id, 'bridge-disconnected', message)
    }
  }

  removePort(port: ResponsePort): void {
    for (const [id, entry] of this.pending) {
      if (entry.port !== port) continue
      clearTimeout(entry.timer)
      this.pending.delete(id)
    }
  }

  private take(id: string): PendingResponse | undefined {
    const entry = this.pending.get(id)
    if (entry === undefined) return undefined
    clearTimeout(entry.timer)
    this.pending.delete(id)
    return entry
  }

  private postError(port: ResponsePort, id: string, code: string, message: string): void {
    try { port.postMessage({ type: 'respond.result', id, ok: false, error: { code, message } }) } catch { /* panel already closed */ }
  }
}
