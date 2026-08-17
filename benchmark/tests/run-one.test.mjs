import test from 'node:test'
import assert from 'node:assert/strict'
import { appendEventTypeRun } from '../lib/run-one.mjs'

test('event diagnostics use lossless run-length encoding', () => {
  const eventTypeRuns = []
  for (const type of ['assistant/chunk', 'assistant/chunk', 'tool/call', 'tool/result', 'tool/result']) {
    appendEventTypeRun(eventTypeRuns, type)
  }

  assert.deepEqual(eventTypeRuns, [
    { type: 'assistant/chunk', count: 2 },
    { type: 'tool/call', count: 1 },
    { type: 'tool/result', count: 2 },
  ])
  assert.deepEqual(eventTypeRuns.flatMap((run) => Array(run.count).fill(run.type)), [
    'assistant/chunk',
    'assistant/chunk',
    'tool/call',
    'tool/result',
    'tool/result',
  ])
})
