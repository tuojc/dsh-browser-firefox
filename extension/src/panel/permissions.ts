/**
 * 权限级别（盾牌菜单单选）：locked 全拒 / read 只读 / readwrite 全放行。
 * 与 background/authorization.ts 的 PermissionLevel 保持一致。
 *
 * @module
 */

export type { PermissionLevel } from '../background/authorization.ts'

export const PERMISSION_LEVEL_LABELS: Record<import('../background/authorization.ts').PermissionLevel, string> = {
  locked: '锁定（不碰页面）',
  read: '只读（可读页面，禁止操作）',
  readwrite: '读写（读取与操作都允许）',
}

export const PERMISSION_LEVEL_HINTS: Record<import('../background/authorization.ts').PermissionLevel, string> = {
  locked: '助手只能聊天，读取与操作都会被拒绝',
  read: '可读取页面内容；点击/输入/导航等会被拒绝',
  readwrite: '读取与操作全部自动允许',
}
