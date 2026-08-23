// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { progressLabel } from '../src/panel/progress.ts'
import type { Row } from '../src/panel/events.ts'

describe('progressLabel', () => {
  it('无消息时是「正在思考」', () => {
    expect(progressLabel([])).toBe('正在思考')
  })

  it('工具运行中是「正在操作页面」', () => {
    const rows: Row[] = [{ seq: 1, kind: 'tool', text: '读取页面', status: 'running' }]
    expect(progressLabel(rows)).toBe('正在操作页面')
  })

  it('工具完成后是「正在整理结果」', () => {
    const rows: Row[] = [{ seq: 1, kind: 'tool', text: '读取页面', status: 'complete' }]
    expect(progressLabel(rows)).toBe('正在整理结果')
  })

  it('用户/助手消息后回到「正在思考」', () => {
    const rows: Row[] = [{ seq: 1, kind: 'assistant', text: 'hi' }]
    expect(progressLabel(rows)).toBe('正在思考')
  })
})

