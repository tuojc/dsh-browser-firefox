/**
 * Wire contract between the dsh bridge plugin and the browser extension.
 *
 * Zero-dependency module (pure types, constants, and a parser): both the
 * plugin (node) and the Firefox extension (browser bundle) import this file,
 * so the frame shapes can never drift between the two halves.
 *
 * Frames are one JSON object per WebSocket message, discriminated by `t`.
 * Correlation ids (`id`) are minted by the requestor and echoed by the
 * responder; they are opaque strings, never parsed.
 *
 * The RPC/stream vocabulary is the alpha Typert Remote dialect verbatim:
 * methods are slash-joined endpoints (`session/create`), `args` is the Remote
 * descriptor's native args object (`{ request: {...} }`, `{ _request: {} }`),
 * and stream frames carry the native Session/Workspace follow frames
 * unmodified.
 *
 * @module
 */

/** WebSocket pathname the bridge plugin registers on the host webserver. */
export const BRIDGE_PATH = '/ext/bridge'

/** Zero-config discovery endpoint: returns `{ wsUrl }` for the extension. */
export const BRIDGE_CONFIG_PATH = '/ext/bridge-config'

/** Seconds a fresh socket may take to present `hello` before it is closed. */
export const HELLO_TIMEOUT_MS = 5_000

/** Server-side ping cadence; the client answers `pong` to prove liveness. */
export const PING_INTERVAL_MS = 30_000

/** Default bytes of the generated bearer token (256-bit). */
export const DEFAULT_TOKEN_BYTES = 32

/** Error codes a tool call may settle with. Open set: consumers must tolerate unknown codes. */
export type ToolErrorCode =
  | 'no-active-tab'
  | 'content-unavailable'
  | 'action-failed'
  | 'timeout'
  | 'bridge-closed'
  | 'bad-args'
  | 'approval-denied'
  | 'cancelled'
  | 'internal'

/** One tool-call failure: stable machine code plus human text for the model. */
export interface ToolError {
  code: ToolErrorCode
  message: string
}

/**
 * Capabilities negotiated in `hello`/`hello.ok`. The extension performs its
 * own actions; the numeric bounds shape page snapshots. Optional booleans are
 * feature advertisements: a peer that does not know a flag simply leaves it
 * undefined, and the feature stays off for that pairing (graceful
 * cross-version degradation; same-version pairing is still the support
 * contract). Legacy 0.4.x `textOnly` is gone: DeepSeek routes on the 0.1.2
 * line read images natively, so screenshots now cross the bridge as image
 * blocks instead of file paths.
 */
export interface BridgeCaps {
  /** Upper bound on one rendered snapshot's characters (plugin config). */
  snapshotMaxChars: number
  /** Upper bound on interactive inventory items per snapshot (plugin config). */
  maxInteractiveItems: number
  /** Client advertises it can render ask_user_question cards; the plugin only claims the user-questions waterfall for extension-owned sessions when set. */
  questions?: boolean
}

/** One Remote failure as plain wire data (RemoteError's message is non-enumerable, so it is restated explicitly). */
export interface RemoteWireFailure {
  code: string
  message: string
  details?: object
}

/** The RemoteResult wire form answered to one `rpc` frame. */
export type RemoteWireResult =
  | { ok: true; value: unknown }
  | { ok: false; error: RemoteWireFailure }

/** One ask_user_question option (the host AskUserQuestionOption wire form). */
export interface QuestionOption {
  label: string
  description?: string
}

/**
 * One ask_user_question item as it crosses the bridge (the host
 * AskUserQuestionItem wire form, minus the host-internal `intent`).
 */
export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

/** Frames sent by the extension to the bridge plugin. */
export type ClientFrame =
  /** First frame, within HELLO_TIMEOUT_MS of socket open. `version` (extension version) lets the plugin detect a version mismatch; absent on pre-0.4.6 clients. */
  | { t: 'hello'; token: string; caps: BridgeCaps; version?: string }
  /** Unary Remote call: slash-joined endpoint plus the descriptor's native args object. */
  | { t: 'rpc'; id: string; method: string; args: Record<string, unknown> }
  /** Open one Remote stream (`session/follow`, `workspace/follow`); frames arrive as `stream.frame`. */
  | { t: 'stream.open'; id: string; method: string; args: Record<string, unknown> }
  /** Cancel one open stream. */
  | { t: 'stream.close'; id: string }
  /** Result of a previously dispatched tool call. */
  | { t: 'tool.result'; id: string; ok: true; result: unknown }
  | { t: 'tool.result'; id: string; ok: false; error: ToolError }
  /** Liveness reply. */
  | { t: 'pong' }

/** Frames sent by the bridge plugin to the extension. */
export type ServerFrame =
  /** Accepted after a valid `hello`. `version` (plugin version) lets the extension detect a version mismatch; absent on pre-0.4.6 servers. */
  | { t: 'hello.ok'; caps: BridgeCaps; version?: string }
  /** Reply to an `rpc` frame: the RemoteResult wire form, flattened onto the frame. */
  | { t: 'rpc.result'; id: string; ok: true; value: unknown }
  | { t: 'rpc.result'; id: string; ok: false; error: RemoteWireFailure }
  /** One native frame of an open stream (SessionFollowFrame / WorkspaceFollowFrame, unmodified). */
  | { t: 'stream.frame'; id: string; frame: unknown }
  /** A stream failed (or its open was rejected); the client may reopen it. */
  | { t: 'stream.error'; id: string; message: string }
  /** A model-requested browser action to execute in the user-controlled tab. `expiresAt` (ms epoch) withdraws the call once the caller stops waiting. */
  | { t: 'tool.call'; id: string; name: string; args: Record<string, unknown>; expiresAt?: number; sessionId?: string; title?: string }
  /** Withdraw a tool call that timed out or whose caller was cancelled. */
  | { t: 'tool.cancel'; id: string }
  /**
   * The host asked the user (ask_user_question) in an extension-owned session
   * and the bridge claimed the waterfall: the extension should render a
   * question card. The answer rides a normal `rpc` frame with the
   * plugin-local method `bridge/questionAnswer` (args `{questionId, sessionId,
   * answer?} | {questionId, sessionId, decline: true}`), answered
   * `{accepted: true} | {accepted: false, reason: 'not-pending'}`.
   */
  | { t: 'question.requested'; id: string; sessionId: string; questions: QuestionItem[] }
  /** A previously pushed question is gone (host aborted it or the bridge delegated the waterfall elsewhere); dismiss the card without answering. */
  | { t: 'question.resolved'; id: string; sessionId: string }
  /** Liveness probe. */
  | { t: 'ping' }
  /** Fatal connection error; the client should re-authenticate. */
  | { t: 'error'; code: string; message: string }

/** Any frame on the wire. */
export type BridgeFrame = ClientFrame | ServerFrame

/**
 * Type guard: is this frame one the SERVER may send? Client-only shapes
 * (hello/rpc/stream.open/stream.close/tool.result/pong) narrow out, so
 * server-side consumers never dispatch on their own request vocabulary.
 * @param frame - parsed frame.
 * @returns true for server-sendable frames.
 */
export function isServerFrame(frame: BridgeFrame): frame is ServerFrame {
  return frame.t === 'hello.ok'
    || frame.t === 'rpc.result'
    || frame.t === 'stream.frame'
    || frame.t === 'stream.error'
    || frame.t === 'tool.call'
    || frame.t === 'tool.cancel'
    || frame.t === 'question.requested'
    || frame.t === 'question.resolved'
    || frame.t === 'ping'
    || frame.t === 'error'
}

/**
 * Type guard: is this frame one the CLIENT may send? Server-only shapes
 * narrow out, so client-side consumers never dispatch on server vocabulary.
 * @param frame - parsed frame.
 * @returns true for client-sendable frames.
 */
export function isClientFrame(frame: BridgeFrame): frame is ClientFrame {
  return frame.t === 'hello'
    || frame.t === 'rpc'
    || frame.t === 'stream.open'
    || frame.t === 'stream.close'
    || frame.t === 'tool.result'
    || frame.t === 'pong'
}

/** Wire args must be a plain object (the Remote descriptor's named arguments). */
function isArgs(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse one WebSocket message into a frame.
 * @param text - raw message text.
 * @returns the frame, or `undefined` when the message is not a valid frame.
 */
export function parseBridgeFrame(text: string): BridgeFrame | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const frame = value as Record<string, unknown>
  if (typeof frame.t !== 'string') return undefined
  switch (frame.t) {
    case 'hello':
      if (typeof frame.token !== 'string' || !isCaps(frame.caps)) return undefined
      if (frame.version !== undefined && typeof frame.version !== 'string') return undefined
      return {
        t: 'hello',
        token: frame.token,
        caps: frame.caps,
        ...(frame.version === undefined ? {} : { version: frame.version as string }),
      }
    case 'rpc':
      return typeof frame.id === 'string' && typeof frame.method === 'string' && isArgs(frame.args)
        ? { t: 'rpc', id: frame.id, method: frame.method, args: frame.args }
        : undefined
    case 'stream.open':
      return typeof frame.id === 'string' && typeof frame.method === 'string' && isArgs(frame.args)
        ? { t: 'stream.open', id: frame.id, method: frame.method, args: frame.args }
        : undefined
    case 'stream.close':
      return typeof frame.id === 'string' ? { t: 'stream.close', id: frame.id } : undefined
    case 'tool.result':
      if (typeof frame.id !== 'string') return undefined
      if (frame.ok === true && 'result' in frame) {
        return { t: 'tool.result', id: frame.id, ok: true, result: frame.result }
      }
      return isToolError(frame.error)
        ? { t: 'tool.result', id: frame.id, ok: false, error: frame.error }
        : undefined
    case 'pong':
      return { t: 'pong' }
    case 'hello.ok':
      if (!isCaps(frame.caps)) return undefined
      if (frame.version !== undefined && typeof frame.version !== 'string') return undefined
      return {
        t: 'hello.ok',
        caps: frame.caps,
        ...(frame.version === undefined ? {} : { version: frame.version as string }),
      }
    case 'rpc.result':
      if (typeof frame.id !== 'string') return undefined
      if (frame.ok === true && 'value' in frame) {
        return { t: 'rpc.result', id: frame.id, ok: true, value: frame.value }
      }
      return isWireFailure(frame.error)
        ? { t: 'rpc.result', id: frame.id, ok: false, error: frame.error }
        : undefined
    case 'stream.frame':
      return typeof frame.id === 'string'
        ? { t: 'stream.frame', id: frame.id, frame: frame.frame }
        : undefined
    case 'stream.error':
      return typeof frame.id === 'string' && typeof frame.message === 'string'
        ? { t: 'stream.error', id: frame.id, message: frame.message }
        : undefined
    case 'tool.call':
      if (typeof frame.id !== 'string' || typeof frame.name !== 'string') return undefined
      if (typeof frame.args !== 'object' || frame.args === null || Array.isArray(frame.args)) return undefined
      // expiresAt is optional for backwards compatibility with pre-0.3.1
      // plugins; when present it must be a finite positive ms-epoch.
      if (frame.expiresAt !== undefined
        && (typeof frame.expiresAt !== 'number' || !Number.isFinite(frame.expiresAt) || frame.expiresAt <= 0)) return undefined
      return {
        t: 'tool.call',
        id: frame.id,
        name: frame.name,
        args: frame.args as Record<string, unknown>,
        ...(typeof frame.expiresAt === 'number' ? { expiresAt: frame.expiresAt } : {}),
        ...(typeof frame.sessionId === 'string' ? { sessionId: frame.sessionId } : {}),
        ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
      }
    case 'tool.cancel':
      return typeof frame.id === 'string' ? { t: 'tool.cancel', id: frame.id } : undefined
    case 'question.requested':
      return typeof frame.id === 'string'
        && typeof frame.sessionId === 'string'
        && Array.isArray(frame.questions)
        && frame.questions.length > 0
        && frame.questions.every(isQuestionItem)
        ? { t: 'question.requested', id: frame.id, sessionId: frame.sessionId, questions: frame.questions }
        : undefined
    case 'question.resolved':
      return typeof frame.id === 'string' && typeof frame.sessionId === 'string'
        ? { t: 'question.resolved', id: frame.id, sessionId: frame.sessionId }
        : undefined
    case 'ping':
      return { t: 'ping' }
    case 'error':
      return typeof frame.code === 'string' && typeof frame.message === 'string'
        ? { t: 'error', code: frame.code, message: frame.message }
        : undefined
    default:
      return undefined
  }
}

function isCaps(value: unknown): value is BridgeCaps {
  if (typeof value !== 'object' || value === null) return false
  const caps = value as Record<string, unknown>
  // Unknown keys (legacy `textOnly`, future flags) are tolerated: each side
  // only acts on the flags it understands.
  return typeof caps.snapshotMaxChars === 'number' && caps.snapshotMaxChars > 0
    && typeof caps.maxInteractiveItems === 'number' && caps.maxInteractiveItems > 0
    && (caps.questions === undefined || typeof caps.questions === 'boolean')
}

/** Narrow one question item; unknown extra keys (e.g. host `intent`) pass through. */
function isQuestionItem(value: unknown): value is QuestionItem {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return typeof item.id === 'string' && typeof item.question === 'string'
}

function isToolError(value: unknown): value is ToolError {
  return typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>).code === 'string'
    && typeof (value as Record<string, unknown>).message === 'string'
}

function isWireFailure(value: unknown): value is RemoteWireFailure {
  return typeof value === 'object' && value !== null
    && typeof (value as Record<string, unknown>).code === 'string'
    && typeof (value as Record<string, unknown>).message === 'string'
}
