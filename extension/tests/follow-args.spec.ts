// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { sessionFollowArgs, subagentFollowArgs } from 'dsh-browser-firefox/src/session-follow.ts'

/** 与插件侧 followedSessionOf 共用同一模块：形状只有一个真实来源。 */
describe('sessionFollowArgs', () => {
  it('构造宿主 SessionFollowRequest 的普通会话地址', () => {
    expect(sessionFollowArgs('s1')).toEqual({ request: { address: { kind: 'session', sessionId: 's1' } } })
  })

  it('保留 subagent 子会话形态的完整字段', () => {
    expect(subagentFollowArgs('p1', 'c1', 'one-shot')).toEqual({
      request: { address: { kind: 'subagent', parentSessionId: 'p1', childSessionId: 'c1', mode: 'one-shot' } },
    })
    expect(subagentFollowArgs('p1', 'c1').request.address).toMatchObject({ mode: 'unknown' })
  })
})
