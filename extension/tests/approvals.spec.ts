// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { approvalReceiptReason, approvalReasonText } from '../src/panel/approvals.ts'
import type { PendingApproval } from '../src/panel/events.ts'

const approval: PendingApproval = { approvalId: 'a1', sessionId: 's1', toolName: 'bash' }

describe('approvalReceiptReason', () => {
  it('maps bridge receipts to dispositions', () => {
    expect(approvalReceiptReason({ accepted: true })).toBe('accepted')
    expect(approvalReceiptReason({ accepted: false, reason: 'not-pending' })).toBe('not-pending')
    expect(approvalReceiptReason({ accepted: false, reason: 'bad-decision' })).toBe('bad-decision')
    expect(approvalReceiptReason({ accepted: false, reason: 'weird' })).toBe('retry')
    expect(approvalReceiptReason(null)).toBe('retry')
    expect(approvalReceiptReason('nope')).toBe('retry')
  })
})

describe('approvalReasonText', () => {
  it('prefers the host reason and falls back to a neutral line', () => {
    expect(approvalReasonText({ ...approval, reason: '需要写入工作区外的文件' })).toBe('需要写入工作区外的文件')
    expect(approvalReasonText({ ...approval, reason: '   ' })).toContain('确认')
    expect(approvalReasonText(approval)).toContain('确认')
  })
})
