// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { PERMISSION_LEVEL_HINTS, PERMISSION_LEVEL_LABELS } from '../src/panel/permissions.ts'

describe('permission level labels', () => {
  it('covers exactly the three levels with labels and hints', () => {
    expect(Object.keys(PERMISSION_LEVEL_LABELS).sort()).toEqual(['locked', 'read', 'readwrite'])
    expect(Object.keys(PERMISSION_LEVEL_HINTS).sort()).toEqual(['locked', 'read', 'readwrite'])
    expect(PERMISSION_LEVEL_LABELS.locked).toContain('锁定')
    expect(PERMISSION_LEVEL_LABELS.read).toContain('只读')
    expect(PERMISSION_LEVEL_LABELS.readwrite).toContain('读写')
  })
})
