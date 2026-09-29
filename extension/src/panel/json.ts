/**
 * 面板侧最小的 JSON 结构判定：解析宿主/桥下发的不可信载荷时统一用它，
 * 免得每个模块各带一份同实现。
 *
 * @module
 */

/** 是否为「普通对象」（排除 null 与数组）。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
