/**
 * 顶部工具栏 action 图标 → 打开/收起侧边栏。
 * Firefox 的 action 按钮默认没有任何点击行为，必须注册 onClicked 处理器，
 * 否则安装后顶部图标只是摆设，只有 sidebar_action 侧边栏入口能打开面板。
 * sidebarAction 是 Firefox 专有 API（@types/chrome 未收录），由 index.ts 用窄化类型接入；
 * toggle() 需要用户手势，而 action.onClicked 回调天然具备，因而可安全调用。
 *
 * @module
 */

/** Firefox `sidebarAction` 的最小接口（仅用 toggle()）。 */
export interface SidebarActionApi {
  toggle(): Promise<void>
}

/**
 * 把「点击顶部工具栏图标 → 切换侧边栏」的处理器注册到 action。
 * @param action - browser.action（提供 onClicked 事件）。
 * @param sidebar - browser.sidebarAction（Firefox 专有，调用方需窄化断言）。
 */
export function registerToolbarAction(
  action: { onClicked: { addListener(cb: () => void): void } },
  sidebar: SidebarActionApi,
): void {
  action.onClicked.addListener(() => {
    // 全屏、无活动窗口等场景下 toggle() 可能 reject：吞掉，不留未处理拒绝，
    // 面板状态在下次点击时再恢复。
    void sidebar.toggle().catch(() => {})
  })
}
