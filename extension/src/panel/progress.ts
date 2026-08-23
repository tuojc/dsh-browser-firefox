/**
 * Bottom progress-bar label: stays mounted the whole time the assistant is
 * working, and only its text changes per phase — so the row never appears or
 * disappears and the panel does not jump.
 *
 * @module
 */

import type { Row } from './events.ts'

/** Phase label for the persistent progress indicator. */
export function progressLabel(rows: Row[]): string {
  const last = rows[rows.length - 1]
  if (last?.kind === 'tool') return last.status === 'running' ? '正在操作页面' : '正在整理结果'
  return '正在思考'
}
