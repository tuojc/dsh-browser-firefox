import { randomUUID } from 'node:crypto'

export class DshRpcError extends Error {
  constructor(method, error) {
    super(`${method}: ${error?.code ?? 'unknown'}: ${error?.message ?? 'DSH RPC failed'}`)
    this.name = 'DshRpcError'
    this.method = method
    this.code = error?.code
    this.details = error?.details
  }
}

export class DshClient {
  constructor(baseUrl) {
    this.baseUrl = new URL(baseUrl)
    this.listeners = new Set()
    this.socket = null
  }

  async rpc(method, payload = {}, { signal, timeoutMs = 30_000 } = {}) {
    const rpcId = randomUUID()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error(`${method} timed out after ${timeoutMs}ms`)), timeoutMs)
    const combinedSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal])
    try {
      const response = await fetch(new URL(`/api/${method}`, this.baseUrl), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload }),
        signal: combinedSignal,
      })
      if (!response.ok) throw new Error(`${method}: HTTP ${response.status}: ${await response.text()}`)
      const envelope = await response.json()
      if (envelope.rpcId !== rpcId) throw new Error(`${method}: rpcId mismatch`)
      if (envelope.result?.ok !== true) throw new DshRpcError(method, envelope.result?.error)
      return envelope.result.value
    } finally {
      clearTimeout(timer)
    }
  }

  async connectMux(timeoutMs = 15_000) {
    if (this.socket?.readyState === WebSocket.OPEN) return
    this.socket?.close()
    const url = new URL('/api/events.mux', this.baseUrl)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    this.socket = socket
    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return
      let envelope
      try {
        envelope = JSON.parse(message.data)
      } catch {
        return
      }
      if (envelope?.type !== 'server-request' || typeof envelope.payload?.type !== 'string') return
      const receivedAt = performance.now()
      for (const listener of this.listeners) {
        try { listener(envelope.payload, receivedAt, envelope) } catch { /* observer errors do not break the stream */ }
      }
    })
    try {
      await new Promise((resolve, reject) => {
        let timer
        const cleanup = () => {
          clearTimeout(timer)
          socket.removeEventListener('open', opened)
          socket.removeEventListener('error', failed)
        }
        const opened = () => {
          cleanup()
          resolve()
        }
        const failed = () => {
          cleanup()
          reject(new Error('DSH mux WebSocket failed to open'))
        }
        timer = setTimeout(() => {
          cleanup()
          reject(new Error(`DSH mux did not open within ${timeoutMs}ms`))
        }, timeoutMs)
        socket.addEventListener('open', opened)
        socket.addEventListener('error', failed)
      })
    } catch (error) {
      if (this.socket === socket) this.socket = null
      socket.close()
      throw error
    }
  }

  onFrame(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  close() {
    this.socket?.close()
    this.socket = null
    this.listeners.clear()
  }
}

export async function waitForDsh(baseUrl, { timeoutMs = 60_000, process } = {}) {
  const client = new DshClient(baseUrl)
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (process?.exitCode !== null && process?.exitCode !== undefined) {
      client.close()
      throw new Error(`DSH exited before becoming ready (exit ${process.exitCode})`)
    }
    try {
      await client.rpc('host.describe', {}, { timeoutMs: 1_500 })
      await client.connectMux()
      return client
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  client.close()
  throw new Error(`DSH did not become ready at ${baseUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}
