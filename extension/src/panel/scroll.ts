/** Pure scroll-metrics helpers for the panel's stick-to-bottom logic. */
export function isAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number, threshold = 8): boolean {
  // 阈值收紧：用户离开贴底部超过 8px 即视为「手动打断」，停止跟随并显示「回到底部」。
  return scrollHeight - scrollTop - clientHeight < threshold
}
