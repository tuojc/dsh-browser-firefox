/**
 * 两端版本一致性检查：hello/hello.ok 互带版本号（0.4.6+），
 * 面板据此提示用户同时更新插件与扩展。
 *
 * @module
 */

/** 两端版本都已知且不相等 → 提示更新。旧对端不带版本号（null/undefined/空串）时不提示。 */
export function versionMismatch(extensionVersion: string, pluginVersion: string | null | undefined): boolean {
  return pluginVersion !== null && pluginVersion !== undefined && pluginVersion !== '' && pluginVersion !== extensionVersion
}

/**
 * 设置页「dsh 插件」一行的文案：已连接却拿不到版本号时说明是旧插件
 * （0.4.6 之前不互带 version），未连接时直说未连接。
 */
export function pluginVersionLabel(
  pluginVersion: string | null | undefined,
  state: 'connected' | 'connecting' | 'reconnecting' | 'stopped' | 'unauthorized',
): string {
  if (pluginVersion !== null && pluginVersion !== undefined && pluginVersion !== '') return pluginVersion
  return state === 'connected' ? '未知（插件版本过旧）' : '未连接'
}
