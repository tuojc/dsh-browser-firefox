// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { applyWorkspaceFrame, pickCurrentSession, resolveBrowserSessions, type SessionView, type WorkspaceView } from '../src/panel/sessions.ts'

describe('resolveBrowserSessions', () => {
  const workspaces: WorkspaceView[] = [
    { workspaceId: 'w1', path: '/Users/tjc/Downloads/dsh-browser-firefox', title: 'dsh-browser-firefox', sessionIds: ['s-repo'] },
    { workspaceId: 'w2', path: '/Users/tjc/.dsh/browser-sessions', title: 'browser-sessions', sessionIds: ['s-a', 's-b', 's-c'] },
    { workspaceId: 'w3', path: '/Users/tjc/Downloads', title: 'Downloads', sessionIds: ['s-dl'] },
  ]
  const sessions: SessionView[] = [
    { sessionId: 's-repo', updatedAt: 10, projections: { values: { title: 'repo' } } },
    { sessionId: 's-a', updatedAt: 100, projections: { values: { title: '较新' } } },
    { sessionId: 's-b', updatedAt: 300, projections: { values: { title: '最新' } } },
    { sessionId: 's-c', updatedAt: 50 }, // 无标题 → 「新会话」
    { sessionId: 's-dl', updatedAt: 999, projections: { values: { title: '下载' } } },
  ]

  it('只保留 browser-sessions 工作区的会话，并按时间倒序', () => {
    const list = resolveBrowserSessions(workspaces, sessions)
    expect(list.map((s) => s.sessionId)).toEqual(['s-b', 's-a', 's-c'])
  })

  it('缺标题的会话显示为「新会话」', () => {
    const list = resolveBrowserSessions(workspaces, sessions)
    expect(list.find((s) => s.sessionId === 's-c')?.title).toBe('新会话')
  })

  it('没有 browser-sessions 工作区时返回空列表', () => {
    const list = resolveBrowserSessions([workspaces[0]!], sessions)
    expect(list).toEqual([])
  })
})

describe('pickCurrentSession', () => {
  const list = [
    { sessionId: 's-b', title: '最新', updatedAt: 300 },
    { sessionId: 's-a', title: '较新', updatedAt: 100 },
  ]

  it('持久化的 id 仍存在时优先恢复它', () => {
    expect(pickCurrentSession(list, 's-a')?.sessionId).toBe('s-a')
  })

  it('持久化 id 失效时回退到最新的会话', () => {
    expect(pickCurrentSession(list, 'gone')?.sessionId).toBe('s-b')
    expect(pickCurrentSession(list, null)?.sessionId).toBe('s-b')
  })

  it('列表为空时返回 null（进入空状态）', () => {
    expect(pickCurrentSession([], 'anything')).toBeNull()
  })
})

describe('applyWorkspaceFrame (workspace/follow 折叠)', () => {
  const w = (id: string, title = id): WorkspaceView => ({ workspaceId: id, path: `/tmp/${id}`, title, sessionIds: [] })

  it('baseline 替换整个列表', () => {
    expect(applyWorkspaceFrame([w('old')], { type: 'baseline', value: { items: [w('a'), w('b')] } }).map((x) => x.workspaceId))
      .toEqual(['a', 'b'])
  })

  it('upsert 更新已有项或追加新项', () => {
    const renamed = applyWorkspaceFrame([w('a')], { type: 'upsert', workspace: w('a', 'renamed') })
    expect(renamed).toHaveLength(1)
    expect(renamed[0]!.title).toBe('renamed')
    expect(applyWorkspaceFrame([w('a')], { type: 'upsert', workspace: w('b') }).map((x) => x.workspaceId)).toEqual(['a', 'b'])
  })

  it('remove 删除对应项，order 重排', () => {
    const removed = applyWorkspaceFrame([w('a'), w('b')], { type: 'remove', workspaceId: 'a' })
    expect(removed.map((x) => x.workspaceId)).toEqual(['b'])
    const ordered = applyWorkspaceFrame([w('a'), w('b'), w('c')], { type: 'order', workspaceIds: ['c', 'a'] })
    expect(ordered.map((x) => x.workspaceId)).toEqual(['c', 'a', 'b'])
  })

  it('archived 帧不影响列表', () => {
    const items = [w('a')]
    expect(applyWorkspaceFrame(items, { type: 'archived' })).toBe(items)
  })
})
