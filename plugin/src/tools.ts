/**
 * Model-facing browser tools. Every tool executes by dispatching a `tool.call`
 * over the bridge to the connected extension, which performs the action in the
 * user's active tab and returns a pure-text result.
 *
 * The whole surface is text-only by design (DeepSeek models have no vision):
 * `browser_snapshot` renders the page as structured text with a numbered
 * interactive inventory, and every other tool addresses elements by that
 * inventory's stable index. Results are single `{ text }` objects rendered as
 * one text ContentBlock.
 *
 * @module
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { mkdir, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { BridgeServer } from './server.ts'

/** Options resolved from plugin config before tool registration. */
export interface BrowserToolsOptions {
  /** Per-tool-call budget in ms (also the bridge's default). */
  toolTimeoutMs: number
  /** Upper bound on one snapshot's rendered characters. */
  snapshotMaxChars: number
  /** Upper bound on interactive inventory items per snapshot. */
  maxInteractiveItems: number
}

/** 截图临时目录名（位于 session workspace 下）。 */
const SCREENSHOT_DIR_NAME = '.dsh-browser-tmp'
/** 截图目录最多保留的张数，超出自动删最旧（不留垃圾）。 */
const MAX_SCREENSHOTS = 20

/** 截图目录：保存在 session workspace 下（视觉工具能读），失败回退 dshHomePath。 */
function screenshotDir(workspacePath: string): string {
  return join(workspacePath, SCREENSHOT_DIR_NAME)
}

/** 解析 session workspace：优先 exec.agent.session.header.cwd，回退 process.cwd / dshHomePath。 */
function resolveWorkspace(exec: { agent?: { session?: { header?: { cwd?: string } } } | null }): string {
  const cwd = exec.agent?.session?.header?.cwd
  if (cwd !== undefined && cwd !== '') return cwd
  try {
    return process.cwd()
  } catch {
    return dshHomePath('browser-screenshots')
  }
}

/** 保存一张截图（data URL → PNG 文件），返回绝对路径；超上限删最旧。 */
async function saveScreenshot(dataUrl: string, workspacePath: string): Promise<string> {
  const match = /^data:image\/(?:png|jpeg);base64,(.+)$/.exec(dataUrl)
  if (match === null) throw new Error('扩展返回的不是图片 data URL')
  const encoded = match[1]
  if (encoded === undefined) throw new Error('data URL 缺少 base64 内容')
  const dir = screenshotDir(workspacePath)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `screenshot-${Date.now()}.png`)
  await writeFile(file, Buffer.from(encoded, 'base64'))
  await pruneScreenshots(dir)
  return file
}

/** 删除截图目录里最旧的截图，直到数量 <= MAX_SCREENSHOTS。 */
async function pruneScreenshots(dir: string): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(dir)).filter((f) => /^screenshot-\d+\.png$/.test(f)).sort()
  } catch {
    return
  }
  while (files.length > MAX_SCREENSHOTS) {
    const oldest = files.shift()
    if (oldest !== undefined) await unlink(join(dir, oldest)).catch(() => {})
  }
}

/** 清理全部截图，返回删除数量。 */
async function clearScreenshots(workspacePath: string): Promise<number> {
  const dir = screenshotDir(workspacePath)
  let count = 0
  try {
    const files = (await readdir(dir)).filter((f) => /\.png$/.test(f))
    for (const f of files) {
      await unlink(join(dir, f)).catch(() => {})
      count += 1
    }
  } catch {
    // 目录不存在等，视为无截图
  }
  return count
}

/** Canonical tool result: one text payload. */
interface TextResult {
  text: string
}

/** Output contract shared by every browser tool. */
const TEXT_OUTPUT: ToolDefinition['output'] = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: { text: { type: 'string' } },
    required: ['text'],
  },
  render: (_args, value) => {
    const result = value as unknown as TextResult
    return [{ type: 'text', text: result.text }]
  },
}

/** 显式 JSON Schema object 顶层：空 parameters 对象会被 DeepSeek 适配器序列化成
 * `{ type: null }` 并遭 API 拒绝（400 INVALID_REQUEST），所以每个工具的参数
 * schema 都必须显式声明 `type: 'object'`。 */
const OBJECT_SCHEMA = { type: 'object' as const, additionalProperties: false as const }

/** The keys the extension accepts as wire action names (tool name == action name). */
export const BROWSER_TOOL_NAMES = [
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_navigate',
  'browser_back',
  'browser_forward',
  'browser_reload',
  'browser_get_text',
  'browser_wait',
  'browser_evaluate',
  'browser_screenshot',
  'browser_list_tabs',
] as const

/**
 * Register the browser tools on `ctx.tools`. Disposers are returned for the
 * caller's effect to own; each tool's cooperative timeout budget is declared
 * so `@deepseek-ai/dsh-timeout-policy` can enforce it, and every execute
 * forwards `exec.signal` into the bridge call (abort settles it).
 *
 * @param ctx - Cordis context with the tools service.
 * @param bridge - the authenticated bridge server.
 * @param options - resolved tool budgets.
 * @returns disposers keyed by tool name.
 */
export function registerBrowserTools(
  ctx: Context,
  bridge: BridgeServer,
  options: BrowserToolsOptions,
): Map<string, () => void> {
  const disposers = new Map<string, () => void>()
  const call = async (exec: { signal: AbortSignal; agent?: { id?: string } | null }, name: string, args: Record<string, unknown>): Promise<TextResult> => {
    const sessionId = exec.agent?.id
    const result = await bridge.requestTool(name, args, exec.signal, options.toolTimeoutMs, sessionId)
    return normalizeTextResult(result, name)
  }

  for (const tool of defineTools(call, options)) {
    disposers.set(tool.name, ctx.tools.register(tool))
  }

  // 截图工具：扩展 captureTab 返回 data URL，插件保存为 PNG（多张并存，超上限删最旧）。
  const screenshot: ToolDefinition = {
    name: 'browser_screenshot',
    description: '对当前浏览器页面截图，保存为 PNG 文件并返回绝对路径。'
      + '仅在页面内容是图片/公式/验证码等无法用文本表达时才调用（视觉兜底）。'
      + '截图保存在 session workspace 的 .dsh-browser-tmp/ 目录，最多保留 20 张（超出自动删最旧）；'
      + '看完后可用 browser_clear_screenshots 清理。',
    parameters: {
      ...OBJECT_SCHEMA,
      fullPage: { type: 'boolean', description: '整页滚动截图（暂未实现，预留）。' },
      region: { type: 'string', description: '区域截图 CSS 选择器（暂未实现，预留）。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const sessionId = exec.agent?.id
      const workspace = resolveWorkspace(exec)
      const dataUrl = await bridge.requestTool('browser_screenshot', args as Record<string, unknown>, exec.signal, options.toolTimeoutMs, sessionId)
      if (typeof dataUrl !== 'string') return { text: 'browser_screenshot 返回了非字符串结果' }
      try {
        const path = await saveScreenshot(dataUrl, workspace)
        return { text: `截图已保存: ${path}` }
      } catch (error) {
        return { text: `截图保存失败: ${error instanceof Error ? error.message : String(error)}` }
      }
    },
  }
  disposers.set(screenshot.name, ctx.tools.register(screenshot))

  // 清理工具：删除全部截图（bridge 本地处理，不经扩展）。
  const clearScreenshotsTool: ToolDefinition = {
    name: 'browser_clear_screenshots',
    description: '删除 browser_screenshot 产生的全部临时截图文件，避免残留垃圾。看完截图后可调用。',
    parameters: { ...OBJECT_SCHEMA, properties: {} },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: async (_args, exec) => {
      const workspace = resolveWorkspace(exec)
      const count = await clearScreenshots(workspace)
      return { text: `已清理 ${count} 张截图` }
    },
  }
  disposers.set(clearScreenshotsTool.name, ctx.tools.register(clearScreenshotsTool))

  return disposers
}

/** Normalize the extension's result payload to the canonical `{ text }` shape. */
function normalizeTextResult(result: unknown, name: string): TextResult {
  if (typeof result === 'object' && result !== null && typeof (result as { text?: unknown }).text === 'string') {
    return { text: (result as { text: string }).text }
  }
  return { text: `${name} returned no text: ${JSON.stringify(result)}` }
}

interface Call {
  (exec: { signal: AbortSignal; agent?: { id?: string } | null }, name: string, args: Record<string, unknown>): Promise<TextResult>
}

/** The v1 tool set, model-perspective contracts only (no transport vocabulary). */
function defineTools(call: Call, options: BrowserToolsOptions): ToolDefinition[] {
  const snapshot = (): ToolDefinition => ({
    name: 'browser_snapshot',
    description: '读取当前浏览器页面的结构化文本快照（无截图）：标题、URL、正文摘要、带编号的可交互元素清单、表单字段。'
      + '编号是后续 browser_click/browser_type 等操作的定位依据。页面未变化时设置 delta=true 只返回变化部分，节省上下文。',
    parameters: {
      ...OBJECT_SCHEMA,
      delta: { type: 'boolean', description: 'true 时只返回相对上次快照的变化（编号、URL、标题）。默认 false 返回完整快照。' },
      region: { type: 'string', description: '可选：只读取页面某个区域（CSS 选择器或 "main"），用于懒加载内容。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => {
      const a = args as { delta?: boolean; region?: string }
      return call(exec, 'browser_snapshot', {
        ...a.delta !== undefined ? { delta: a.delta } : {},
        ...a.region !== undefined ? { region: a.region } : {},
      })
    },
  })

  const click = (): ToolDefinition => ({
    name: 'browser_click',
    description: '点击页面元素。用编号 index（来自 browser_snapshot）或 CSS 选择器 selector（配 index 指定第几个匹配）定位。',
    parameters: {
      ...OBJECT_SCHEMA,
      index: { type: 'number', description: 'browser_snapshot 清单中的元素编号（与 selector 二选一）。' },
      selector: { type: 'string', description: 'CSS 选择器（与 index 二选一）。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => call(exec, 'browser_click', args as Record<string, unknown>),
  })

  const type = (): ToolDefinition => ({
    name: 'browser_type',
    description: '向当前页面编号为 index 的输入框输入文本。默认追加到现有值之后；replace=true 时先清空再输入。'
      + '敏感字段（密码/卡号）的值不会回传，输入后立即清空本地记录。',
    parameters: {
      ...OBJECT_SCHEMA,
      index: { type: 'number', required: true, description: '表单字段编号（来自 browser_snapshot 的 forms 清单）。' },
      text: { type: 'string', required: true, description: '要输入的文本。' },
      replace: { type: 'boolean', description: 'true 时清空现有值后输入。默认追加。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => {
      const a = args as { index: number; text: string; replace?: boolean }
      return call(exec, 'browser_type', {
        index: a.index,
        text: a.text,
        ...a.replace !== undefined ? { replace: a.replace } : {},
      })
    },
  })

  const press = (): ToolDefinition => ({
    name: 'browser_press',
    description: '向当前页面发送一个按键。常用值：Enter、Tab、Escape、ArrowUp、ArrowDown、ArrowLeft、ArrowRight、Backspace、Delete。',
    parameters: {
      ...OBJECT_SCHEMA,
      key: { type: 'string', required: true, description: '按键名（KeyboardEvent.key 语义）。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => call(exec, 'browser_press', args as Record<string, unknown>),
  })

  const scroll = (): ToolDefinition => ({
    name: 'browser_scroll',
    description: '滚动当前页面。direction 为 up/down/top/bottom；amount 为像素数（默认一屏）。',
    parameters: {
      ...OBJECT_SCHEMA,
      direction: { type: 'string', required: true, enum: ['up', 'down', 'top', 'bottom'], description: '滚动方向。' },
      amount: { type: 'number', description: '滚动像素数；top/bottom 时忽略。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => {
      const a = args as { direction: 'up' | 'down' | 'top' | 'bottom'; amount?: number }
      return call(exec, 'browser_scroll', {
        direction: a.direction,
        ...a.amount !== undefined ? { amount: a.amount } : {},
      })
    },
  })

  const navigate = (): ToolDefinition => ({
    name: 'browser_navigate',
    description: '在当前标签页导航到指定 URL。保留当前登录状态（cookie/会话）。',
    parameters: {
      ...OBJECT_SCHEMA,
      url: { type: 'string', required: true, description: '完整 URL（http/https）。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => call(exec, 'browser_navigate', args as Record<string, unknown>),
  })

  const simple = (name: 'browser_back' | 'browser_forward' | 'browser_reload' | 'browser_list_tabs', description: string): ToolDefinition => ({
    name,
    description,
    parameters: { ...OBJECT_SCHEMA, properties: {} },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (_args, exec) => call(exec, name, {}),
  })

  const getText = (): ToolDefinition => ({
    name: 'browser_get_text',
    description: '读取当前页面指定区域的文本（用于懒加载内容或局部更新）。不带 selector 时返回整个页面的纯文本。',
    parameters: {
      ...OBJECT_SCHEMA,
      selector: { type: 'string', description: 'CSS 选择器；缺省为整个页面。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => {
      const a = args as { selector?: string }
      return call(exec, 'browser_get_text', { ...a.selector !== undefined ? { selector: a.selector } : {} })
    },
  })

  const wait = (): ToolDefinition => ({
    name: 'browser_wait',
    description: '等待页面稳定（加载完成且无 DOM 变化）。在点击或导航后需要等结果渲染时使用。',
    parameters: {
      ...OBJECT_SCHEMA,
      ms: { type: 'number', description: '额外等待毫秒数；缺省只做稳定性检测。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => {
      const a = args as { ms?: number }
      return call(exec, 'browser_wait', { ...a.ms !== undefined ? { ms: a.ms } : {} })
    },
  })

  const evaluate = (): ToolDefinition => ({
    name: 'browser_evaluate',
    description: '在页面上下文执行受限的 DOM 操作（Firefox 禁止任意 JS，故用预编译操作）。'
      + 'action 支持：count（计数匹配元素）、getText（读文本）、click（点击第 index 个匹配）、setValue（设置值）、querySelectorAll（列出匹配元素）。'
      + '用 CSS 选择器 selector 定位，index 指定第几个匹配（默认 0）。用于 snapshot/click 覆盖不到的 DOM 操作。',
    parameters: {
      ...OBJECT_SCHEMA,
      action: { type: 'string', required: true, enum: ['count', 'getText', 'click', 'setValue', 'querySelectorAll'], description: '操作类型。' },
      selector: { type: 'string', required: true, description: 'CSS 选择器。' },
      index: { type: 'number', description: '匹配元素的序号（默认 0）。' },
      value: { type: 'string', description: 'setValue 时设置的值。' },
    },
    timeoutMs: options.toolTimeoutMs,
    output: TEXT_OUTPUT,
    execute: (args, exec) => call(exec, 'browser_evaluate', args as Record<string, unknown>),
  })

  return [
    snapshot(),
    click(),
    type(),
    press(),
    scroll(),
    navigate(),
    simple('browser_back', '返回上一页。'),
    simple('browser_forward', '前进到下一页。'),
    simple('browser_reload', '重新加载当前页面。'),
    getText(),
    wait(),
    evaluate(),
    simple('browser_list_tabs', '列出当前会话标签页组中的所有标签页（id、标题、URL，当前工作的用 * 标记）。'),
  ]
}
