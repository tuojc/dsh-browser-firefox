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
