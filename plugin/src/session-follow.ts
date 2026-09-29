/**
 * `session/follow` 的参数形状：宿主描述符要求
 * `{request: {address: SessionAddress}}`，其中 address 是
 * `{kind:'session', sessionId}` 或
 * `{kind:'subagent', parentSessionId, childSessionId, mode}`。
 *
 * 扩展用 {@link sessionFollowArgs} 构造订阅参数，插件用
 * {@link followedSessionOf} 从原生 args 里取回「正在展示哪个会话」。两者
 * 同处一个模块，是为了让形状只有**一个**真实来源：0.4.7 曾因插件侧测试用
 * 臆造形状（`request.sessionId`）而没发现 follow 归属在生产环境从未生效。
 *
 * @module @deepseek-ai/dsh-bridge-browser/src/session-follow
 */

/** 普通会话的 follow 地址。 */
export interface SessionFollowAddress {
  kind: 'session'
  sessionId: string
}

/** 直接 subagent 子会话的 follow 地址（宿主 SessionAddress 的另一形态）。 */
export interface SubagentFollowAddress {
  kind: 'subagent'
  parentSessionId: string
  childSessionId: string
  mode: 'one-shot' | 'continuable' | 'unknown'
}

/** 一次性订阅参数（`stream.open` 的 args）。 */
export interface SessionFollowArgs {
  request: {
    address: SessionFollowAddress | SubagentFollowAddress
  }
}

/** 订阅一个普通会话（面板当前会话始终用这一形态）。 */
export function sessionFollowArgs(sessionId: string): SessionFollowArgs {
  return { request: { address: { kind: 'session', sessionId } } }
}

/** 订阅一个 direct subagent 子会话（预留：目前面板不展示子会话）。 */
export function subagentFollowArgs(
  parentSessionId: string,
  childSessionId: string,
  mode: SubagentFollowAddress['mode'] = 'unknown',
): SessionFollowArgs {
  return { request: { address: { kind: 'subagent', parentSessionId, childSessionId, mode } } }
}

/**
 * Session id displayed by a `session/follow` stream, read from the host's
 * `SessionFollowRequest.address`. A subagent address carries the child session
 * on `childSessionId`; ownership then walks up to the parent conversation, so
 * either form routes the card correctly.
 *
 * @param args - native args of the `stream.open` frame.
 * @returns the followed session id, or undefined when absent/malformed.
 */
export function followedSessionOf(args: Record<string, unknown>): string | undefined {
  const request = args.request
  if (typeof request !== 'object' || request === null || Array.isArray(request)) return undefined
  const address = (request as Record<string, unknown>).address
  if (typeof address !== 'object' || address === null || Array.isArray(address)) return undefined
  const fields = address as Record<string, unknown>
  if (fields.kind === 'session') {
    return nonEmptyString(fields.sessionId)
  }
  if (fields.kind === 'subagent') {
    return nonEmptyString(fields.childSessionId)
  }
  return undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}
