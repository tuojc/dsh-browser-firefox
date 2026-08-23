/**
 * Pure conversation-rendering logic: maps session events (live and history)
 * to display rows. Kept framework-free so the wire shapes are unit-tested
 * against the REAL SessionEvent contract: `{ type, seq, time, data }` — the
 * payload always lives in `data`, never on the event root.
 *
 * @module
 */

/** One rendered conversation row. */
export interface Row {
  seq: number
  kind: 'user' | 'assistant' | 'tool' | 'info'
  text: string
  status?: 'running' | 'complete'
}

/** Minimal view of a SessionEvent (payload in `data`). */
export interface SessionEventView {
  type: string
  data?: {
    content?: unknown
    message?: { content?: unknown }
    name?: string
    arguments?: unknown
  }
}

/** Extract model-visible text from content blocks (defensive: unknown block shapes degrade to markers). */
export function textFromBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return String(blocks ?? '')
  const parts: string[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as { type?: string; text?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return parts.join('\n')
}

/** Map one session event to a row (user/assistant only; tools handled separately). */
export function rowFromEvent(event: SessionEventView): Row | null {
  switch (event.type) {
    case 'user/message': {
      // dsh 每轮把运行时常量上下文作为 source.kind='plugin' 的 user/message
      // 记入日志（如 <system-reminder> 注入内容）——它们不是用户消息，
      // 渲染会污染对话流，必须跳过。
      const source = (event.data as { source?: { kind?: string } } | undefined)?.source
      if (source?.kind !== 'user') return null
      const text = textFromBlocks(event.data?.content)
      return text.trim() === '' ? null : { seq: 0, kind: 'user', text }
    }
    case 'assistant/message': {
      // 工具调用也会产生 assistant/message，但其 content 可能只有 tool_use
      // 等非文本块。不要为这种中间事件渲染一个空的 AI 气泡。
      const text = textFromBlocks(event.data?.message?.content)
      return text.trim() === '' ? null : { seq: 0, kind: 'assistant', text }
    }
    default:
      return null
  }
}

const TOOL_LABELS: Record<string, string> = {
  browser_snapshot: '读取页面',
  browser_click: '点击元素',
  browser_type: '填写内容',
  browser_press: '按下按键',
  browser_scroll: '滚动页面',
  browser_navigate: '打开页面',
  browser_back: '返回上一页',
  browser_forward: '前进下一页',
  browser_reload: '刷新页面',
  browser_get_text: '提取文字',
  browser_wait: '等待页面',
}

/** 工具调用的友好展示名：带 index 参数时附上（如「点击元素 #7」）。 */
export function toolSummary(name: string, argsJson: unknown): string {
  let summary = TOOL_LABELS[name] ?? name
  try {
    // tool/call 的 arguments 是 JSON 字符串；tool/code-dispatch 的 arguments 是对象。
    const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson
    if (typeof args === 'object' && args !== null && 'index' in args) {
      summary += ` #${String((args as { index?: unknown }).index)}`
    }
  } catch {
    // 模型参数不可解析：只显示工具名。
  }
  return summary
}

/** live 合并：若最后一行是工具行则并入（连续工具调用不刷屏），否则新增一行。 */
export function appendLiveRow(rows: Row[], kind: Row['kind'], text: string, seq: number): Row[] {
  if (kind === 'tool') {
    const last = rows[rows.length - 1]
    if (last?.kind === 'tool') {
      return [...rows.slice(0, -1), { seq, kind: 'tool', text: `${last.text} → ${text}`, status: 'running' }]
    }
    return [...rows, { seq, kind, text, status: 'running' }]
  }
  return [...rows, { seq, kind, text }]
}

/** 标记最后一行工具调用已完成（并入，不新增行）。 */
export function completeLastTool(rows: Row[], seq: number): Row[] {
  const last = rows[rows.length - 1]
  if (last?.kind === 'tool') {
    return [...rows.slice(0, -1), { ...last, seq, status: 'complete' }]
  }
  return rows
}

/** 历史渲染：连续工具调用归并成一行（tool/call..result 不逐条刷屏；超 3 个折叠计数）。
 * run_code 只是模型包裹浏览器操作的外壳，真实操作名来自随后的 tool/code-dispatch-start。 */
export function mergeHistoryRows(events: SessionEventView[], nextSeq: () => number): Row[] {
  const rows: Row[] = []
  let pendingTool: { items: string[] } | null = null
  let lastCallRunCode = false
  const flushTool = (): void => {
    if (pendingTool === null) return
    const items = pendingTool.items.length === 0 ? ['执行代码'] : pendingTool.items
    const shown = items.slice(0, 3)
    const label = items.length > shown.length
      ? `${shown.join(' → ')} 等${items.length}个操作`
      : shown.join(' → ')
    rows.push({ seq: nextSeq(), kind: 'tool', text: label, status: 'complete' })
    pendingTool = null
  }
  for (const ev of events) {
    if (ev.type === 'tool/call') {
      const name = ev.data?.name ?? 'tool'
      if (pendingTool === null) pendingTool = { items: [] }
      if (name === 'run_code') {
        // 内层页面操作由 tool/code-dispatch-start 提供；这里不记「run_code」。
        lastCallRunCode = true
      } else {
        pendingTool.items.push(toolSummary(name, ev.data?.arguments))
        lastCallRunCode = false
      }
      continue
    }
    if (ev.type === 'tool/code-dispatch-start') {
      if (pendingTool === null) pendingTool = { items: [] }
      pendingTool.items.push(toolSummary(ev.data?.name ?? 'tool', ev.data?.arguments))
      lastCallRunCode = false // 已有内层操作，不再算「纯代码」
      continue
    }
    if (ev.type === 'tool/code-dispatch') continue
    if (ev.type === 'tool/result') {
      if (lastCallRunCode) {
        // 纯代码 run_code（无内层页面操作）：补一行「执行代码」（连续纯代码去重）。
        if (pendingTool === null) pendingTool = { items: [] }
        if (pendingTool.items[pendingTool.items.length - 1] !== '执行代码') pendingTool.items.push('执行代码')
        lastCallRunCode = false
      }
      continue
    }
    const row = rowFromEvent(ev)
    if (row !== null) {
      // 只有真实 user/assistant 文本行才结束当前工具组；step/start、step/end、
      // turn/start、无文本的 assistant/message（reasoning+tool-call）等噪音事件
      // 不落盘、不打断「连续页面操作合并成一个框」。
      flushTool()
      rows.push({ ...row, seq: nextSeq() })
    }
  }
  flushTool()
  return rows
}
