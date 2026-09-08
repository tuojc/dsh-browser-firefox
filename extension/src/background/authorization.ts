/**
 * Tool authorization: every bridge tool call is classified as a page read or
 * a state-changing action, then decided by the user's permission level.
 *
 * Pure module — no browser.* access — so the policy is unit-testable.
 *
 * The permission model is a single level chosen in the panel's shield menu:
 * locked (nothing runs), read (default: observe only), readwrite (full).
 * There are no per-call prompts and no per-session/origin trust lists.
 *
 * @module
 */

/** What kind of power a tool call exercises over the page. */
export type ApprovalKind = 'read' | 'action'

/** Panel-selectable permission level. */
export type PermissionLevel = 'locked' | 'read' | 'readwrite'

/** Read-only tools (observe the page, no state change). */
const READ_TOOLS = new Set([
  'browser_snapshot',
  'browser_get_text',
  'browser_list_tabs',
  'browser_screenshot',
])

/** browser_evaluate 的只读子操作。 */
const READ_EVALUATE_ACTIONS = new Set(['count', 'getText', 'querySelectorAll'])

/**
 * Classify one tool call. browser_evaluate is split by sub-action: DOM
 * queries read, click/setValue act.
 * @param name - tool name.
 * @param args - tool args.
 */
export function classifyTool(name: string, args: Record<string, unknown>): ApprovalKind {
  if (READ_TOOLS.has(name)) return 'read'
  if (name === 'browser_evaluate') {
    return typeof args.action === 'string' && READ_EVALUATE_ACTIONS.has(args.action) ? 'read' : 'action'
  }
  return 'action'
}

/** What a call needs before it may run. */
export type AuthorizationOutcome =
  | { type: 'allow' }
  | { type: 'deny'; reason: string }

const LEVEL_LABEL: Record<PermissionLevel, string> = {
  locked: '锁定',
  read: '只读',
  readwrite: '读写',
}

/**
 * Decide by permission level alone.
 * @param level - the user's chosen level.
 * @param kind - read/action classification.
 */
export function authorizeByLevel(level: PermissionLevel, kind: ApprovalKind): AuthorizationOutcome {
  if (level === 'readwrite') return { type: 'allow' }
  if (level === 'read' && kind === 'read') return { type: 'allow' }
  return {
    type: 'deny',
    reason: `当前权限级别为「${LEVEL_LABEL[level]}」，${kind === 'read' ? '读取页面内容' : '页面操作'}已被拒绝（侧边栏盾牌菜单可切换级别）`,
  }
}
