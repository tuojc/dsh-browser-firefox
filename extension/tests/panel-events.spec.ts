// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import {
  appendLiveRow,
  completeLastTool,
  mergeHistoryRows,
  rowFromEvent,
  textFromBlocks,
  toolSummary,
  type SessionEventView,
} from '../src/panel/events.ts'

/** 构造符合真实 SessionEvent 形状（{ type, seq, time, data }）的事件。 */
function ev(type: string, data: Record<string, unknown>): SessionEventView {
  return { type, data }
}

describe('textFromBlocks', () => {
  it('extracts text blocks and ignores non-text', () => {
    expect(textFromBlocks([{ type: 'text', text: '你好' }, { type: 'reasoning', text: '思考' }])).toBe('你好')
    expect(textFromBlocks(undefined)).toBe('')
    expect(textFromBlocks([{ type: 'text' }])).toBe('')
  })
})

describe('rowFromEvent', () => {
  it('renders user messages from data.content (the real SessionEvent shape)', () => {
    const row = rowFromEvent(ev('user/message', { content: [{ type: 'text', text: '帮我看看页面' }], source: { kind: 'user' } }))
    expect(row).toEqual({ seq: 0, kind: 'user', text: '帮我看看页面' })
  })

  it('skips system-injected user/message events (source.kind = plugin)', () => {
    // dsh 每轮注入的运行时上下文（<system-reminder> 等）是 plugin 来源，
    // 绝不能渲染成用户消息。
    const injected = ev('user/message', {
      content: [{ type: 'text', text: '</system-reminder> 一段很长的系统注入…' }],
      source: { kind: 'plugin', plugin: 'workspace-context' },
    })
    expect(rowFromEvent(injected)).toBeNull()
  })

  it('renders assistant messages from data.message.content', () => {
    const row = rowFromEvent(ev('assistant/message', { message: { content: [{ type: 'text', text: '好的' }] } }))
    expect(row).toEqual({ seq: 0, kind: 'assistant', text: '好的' })
  })

  it('skips assistant events that contain only tool or blank blocks', () => {
    expect(rowFromEvent(ev('assistant/message', {
      message: { content: [{ type: 'tool_use', name: 'browser_snapshot' }] },
    }))).toBeNull()
    expect(rowFromEvent(ev('assistant/message', {
      message: { content: [{ type: 'text', text: '   \n' }] },
    }))).toBeNull()
  })

  it('returns null for non-message events', () => {
    expect(rowFromEvent(ev('turn/start', {}))).toBeNull()
    expect(rowFromEvent(ev('tool/call', { name: 'browser_click' }))).toBeNull()
  })
})

describe('toolSummary', () => {
  it('appends the inventory index when present', () => {
    expect(toolSummary('browser_click', '{"index":7}')).toBe('点击元素 #7')
    expect(toolSummary('browser_snapshot', '{"delta":true}')).toBe('读取页面')
    expect(toolSummary('browser_navigate', 'not-json')).toBe('打开页面')
    expect(toolSummary('custom_tool', '{}')).toBe('custom_tool')
  })

  it('accepts object arguments (tool/code-dispatch shape)', () => {
    expect(toolSummary('browser_click', { index: 7 })).toBe('点击元素 #7')
    expect(toolSummary('browser_snapshot', {})).toBe('读取页面')
  })
})

describe('appendLiveRow / completeLastTool', () => {
  it('merges consecutive tool rows into one line (no tool spam)', () => {
    let rows: ReturnType<typeof appendLiveRow> = []
    rows = appendLiveRow(rows, 'user', '帮我操作页面', 1)
    rows = appendLiveRow(rows, 'tool', '读取页面', 2)
    rows = appendLiveRow(rows, 'tool', '点击元素 #7', 3)
    rows = appendLiveRow(rows, 'tool', '填写内容 #9', 4)
    rows = completeLastTool(rows, 5)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool'])
    expect(rows[1]).toMatchObject({ text: '读取页面 → 点击元素 #7 → 填写内容 #9', status: 'complete' })
    rows = appendLiveRow(rows, 'assistant', '完成', 6)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
  })
})

describe('mergeHistoryRows', () => {
  it('aggregates tool calls and renders user/assistant text from data', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const events = [
      ev('user/message', { content: [{ type: 'text', text: '操作页面' }], source: { kind: 'user' } }),
      ev('turn/start', {}),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
      ev('tool/call', { name: 'browser_click', arguments: '{"index":7}' }),
      ev('tool/result', {}),
      ev('tool/call', { name: 'browser_click', arguments: '{"index":8}' }),
      ev('tool/result', {}),
      ev('assistant/message', { message: { content: [{ type: 'text', text: '已点击' }] } }),
      ev('turn/end', {}),
    ]
    const rows = mergeHistoryRows(events, nextSeq)
    expect(rows.map((r) => r.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(rows[0]!.text).toBe('操作页面')
    expect(rows[2]!.text).toBe('已点击')
    // 连续工具调用归并一行（不逐条刷屏）
    expect(rows[1]).toMatchObject({ text: '读取页面 → 点击元素 #7 → 点击元素 #8', status: 'complete' })
  })

  it('does not restore empty assistant rows from history', () => {
    let seq = 0
    const rows = mergeHistoryRows([
      ev('assistant/message', { message: { content: [{ type: 'tool_use', name: 'browser_snapshot' }] } }),
      ev('tool/call', { name: 'browser_snapshot', arguments: '{}' }),
      ev('tool/result', {}),
    ], () => { seq += 1; return seq })
    expect(rows).toEqual([{ seq: 1, kind: 'tool', text: '读取页面', status: 'complete' }])
  })

  it('handles empty history', () => {
    expect(mergeHistoryRows([], () => 0)).toEqual([])
  })
})

describe('mergeHistoryRows: run_code 与内层页面操作', () => {
  const evc = (name: string, args: unknown): SessionEventView => ev('tool/call', { name, arguments: args })
  const dispatch = (name: string, args: unknown = {}): SessionEventView => ev('tool/code-dispatch-start', { name, arguments: args })

  it('忽略 run_code 外壳，显示内层页面操作名并用箭头合并', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      evc('run_code', '{"description":"导航"}'),
      dispatch('browser_navigate', { url: 'https://x.com' }),
      ev('tool/code-dispatch', {}),
      ev('tool/result', {}),
      evc('run_code', '{"description":"等待并截图"}'),
      dispatch('browser_wait', {}),
      ev('tool/code-dispatch', {}),
      dispatch('browser_snapshot', {}),
      ev('tool/code-dispatch', {}),
      ev('tool/result', {}),
    ], nextSeq)
    expect(rows).toEqual([{ seq: 1, kind: 'tool', text: '打开页面 → 等待页面 → 读取页面', status: 'complete' }])
  })

  it('纯代码 run_code（无内层操作）显示「执行代码」', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      evc('run_code', '{"description":"读文件"}'),
      ev('tool/result', {}),
      evc('run_code', '{"description":"再读文件"}'),
      ev('tool/result', {}),
    ], nextSeq)
    expect(rows).toEqual([{ seq: 1, kind: 'tool', text: '执行代码', status: 'complete' }])
  })

  it('页面操作与纯代码混合时箭头连接', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      evc('run_code', '{}'),
      dispatch('browser_navigate', {}),
      ev('tool/result', {}),
      evc('run_code', '{}'),
      ev('tool/result', {}),
    ], nextSeq)
    expect(rows).toEqual([{ seq: 1, kind: 'tool', text: '打开页面 → 执行代码', status: 'complete' }])
  })

  it('直接工具调用（非 run_code）仍按原名显示', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      evc('browser_click', '{"index":7}'),
      ev('tool/result', {}),
    ], nextSeq)
    expect(rows).toEqual([{ seq: 1, kind: 'tool', text: '点击元素 #7', status: 'complete' }])
  })

  it('跨 step 边界与无文本 assistant/message 仍合并为单框', () => {
    let seq = 0
    const nextSeq = (): number => { seq += 1; return seq }
    const rows = mergeHistoryRows([
      evc('run_code', '{}'),
      dispatch('browser_navigate', {}),
      ev('tool/code-dispatch', {}),
      ev('tool/result', {}),
      ev('step/end', {}),
      ev('step/start', {}),
      // 无文本的 assistant/message（reasoning + tool-call），不打断合并。
      ev('assistant/message', { message: { content: [{ type: 'reasoning', text: '继续' }, { type: 'tool-call', name: 'run_code' }] } }),
      evc('run_code', '{}'),
      dispatch('browser_snapshot', {}),
      ev('tool/code-dispatch', {}),
      ev('tool/result', {}),
      ev('step/end', {}),
      ev('step/start', {}),
      ev('assistant/message', { message: { content: [{ type: 'text', text: '完成' }] } }),
    ], nextSeq)
    expect(rows).toEqual([
      { seq: 1, kind: 'tool', text: '打开页面 → 读取页面', status: 'complete' },
      { seq: 2, kind: 'assistant', text: '完成' },
    ])
  })
})
