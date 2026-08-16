// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { ApprovalRequest } from '../src/security/approval.ts'
import { approvalReadyForSession, approvalSessionToFocus } from '../src/panel/approvals.ts'

const request: ApprovalRequest = {
  id: 'approval-1',
  kind: 'action',
  action: 'browser_click',
  summary: 'Click element [3]',
  origins: ['https://example.com'],
  canTrust: true,
  sessionId: 'session-a',
}

describe('approval session presentation', () => {
  it('queues an approval until its owning session is ready', () => {
    expect(approvalReadyForSession(request, 'session-b', false)).toBe(false)
    expect(approvalSessionToFocus(request, 'session-b', false, true)).toBe('session-a')
    expect(approvalReadyForSession(request, 'session-a', true)).toBe(false)
    expect(approvalReadyForSession(request, 'session-a', false)).toBe(true)
  })

  it('keeps compatibility with approvals from an older bridge', () => {
    const unscoped = { ...request, sessionId: undefined }
    expect(approvalSessionToFocus(unscoped, 'session-b', false, true)).toBeUndefined()
    expect(approvalReadyForSession(unscoped, 'session-b', false)).toBe(true)
  })
})
