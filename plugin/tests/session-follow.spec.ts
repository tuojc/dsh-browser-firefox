import { describe, expect, it } from 'vitest'
import {
  followedSessionOf,
  sessionFollowArgs,
  subagentFollowArgs,
} from '../src/session-follow.ts'

/**
 * 形状回归网：0.4.7 曾因插件测试用了臆造形状（`request.sessionId`）而没发现
 * follow 归属在生产环境从未生效。这里直接断言「扩展构造的参数一定能被插件
 * 解析回来」，形状一改两侧同时失败。
 */
describe('session/follow 参数形状', () => {
  it('扩展构造的普通会话参数能被插件解析回同一 id', () => {
    expect(followedSessionOf(sessionFollowArgs('session-1'))).toBe('session-1')
  })

  it('扩展构造的 subagent 参数解析到子会话 id（随后由祖先上溯归属父会话）', () => {
    expect(followedSessionOf(subagentFollowArgs('parent-1', 'child-1', 'continuable'))).toBe('child-1')
    expect(followedSessionOf(subagentFollowArgs('parent-1', 'child-1'))).toBe('child-1')
  })

  it('与扩展实际发出的 JSON 形状一致', () => {
    // 扩展侧 App.tsx 使用的形态：{request:{address:{kind:'session',sessionId}}}
    expect(JSON.parse(JSON.stringify(sessionFollowArgs('s-9')))).toEqual({
      request: { address: { kind: 'session', sessionId: 's-9' } },
    })
  })

  it('拒绝缺失或畸形的地址', () => {
    expect(followedSessionOf({})).toBeUndefined()
    expect(followedSessionOf({ request: {} })).toBeUndefined()
    expect(followedSessionOf({ request: { address: null } })).toBeUndefined()
    expect(followedSessionOf({ request: { address: { kind: 'other', sessionId: 's' } } })).toBeUndefined()
    expect(followedSessionOf({ request: { address: { kind: 'session' } } })).toBeUndefined()
    expect(followedSessionOf({ request: { address: { kind: 'session', sessionId: '' } } })).toBeUndefined()
    expect(followedSessionOf({ request: { address: { kind: 'subagent', parentSessionId: 'p' } } })).toBeUndefined()
    // 旧的臆造形状不再被接受（防止回归到 bug 版本）
    expect(followedSessionOf({ request: { sessionId: 's' } })).toBeUndefined()
  })
})
