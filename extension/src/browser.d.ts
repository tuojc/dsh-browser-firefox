/**
 * Firefox 原生 WebExtensions 命名空间。
 * 值类型复用 @types/chrome（chrome.* 的 Promise 重载与 browser.* 一致）；
 * 运行时只用 browser.*（Firefox 原生），不再依赖 chrome.* 兼容层。
 * 类型注解仍用 chrome.* 命名空间（类型不产生运行时行为，@types/chrome 提供完整定义）。
 */
declare const browser: typeof chrome
