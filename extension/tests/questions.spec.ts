// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PendingQuestion } from '../src/panel/events.ts'
import {
  answersForQuestion,
  draftFor,
  setQuestionCustomAnswer,
  toggleQuestionOption,
  type QuestionDrafts,
} from '../src/panel/questions.ts'

const QUESTION: PendingQuestion = {
  questionId: 'q1',
  sessionId: 's1',
  questions: [
    { id: 'mode', question: '选模式？', options: [{ label: 'A' }, { label: 'B', description: 'b' }] },
    { id: 'tags', question: '选标签？', multiSelect: true, options: [{ label: 'x' }, { label: 'y' }] },
    { id: 'note', question: '备注？' },
  ],
}

describe('toggleQuestionOption', () => {
  it('single-select replaces the selection and clears custom text', () => {
    let drafts: QuestionDrafts = []
    drafts = setQuestionCustomAnswer(drafts, 0, QUESTION.questions[0]!, 'custom')
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    expect(draftFor(drafts, 0)).toEqual({ selected: ['A'], custom: '' })
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'B', true)
    expect(draftFor(drafts, 0).selected).toEqual(['B'])
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'B', false)
    expect(draftFor(drafts, 0).selected).toEqual([])
  })

  it('multi-select accumulates and unchecks', () => {
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'x', true)
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'y', true)
    expect(draftFor(drafts, 1).selected).toEqual(['x', 'y'])
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'x', false)
    expect(draftFor(drafts, 1).selected).toEqual(['y'])
    // 多选保留自定义文本。
    drafts = setQuestionCustomAnswer(drafts, 1, QUESTION.questions[1]!, 'extra')
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'x', true)
    expect(draftFor(drafts, 1).custom).toBe('extra')
  })
})

describe('setQuestionCustomAnswer', () => {
  it('single-select clears the selection when typing custom', () => {
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    drafts = setQuestionCustomAnswer(drafts, 0, QUESTION.questions[0]!, '别的')
    expect(draftFor(drafts, 0)).toEqual({ selected: [], custom: '别的' })
  })
})

describe('answersForQuestion', () => {
  it('returns null until every question has a response', () => {
    let drafts: QuestionDrafts = []
    expect(answersForQuestion(QUESTION, drafts)).toBeNull()
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    expect(answersForQuestion(QUESTION, drafts)).toBeNull()
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'x', true)
    expect(answersForQuestion(QUESTION, drafts)).toBeNull()
  })

  it('collects answers in question order once complete', () => {
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'x', true)
    drafts = setQuestionCustomAnswer(drafts, 2, QUESTION.questions[2]!, '  你好  ')
    expect(answersForQuestion(QUESTION, drafts)).toEqual([
      { id: 'mode', selected: ['A'] },
      { id: 'tags', selected: ['x'] },
      { id: 'note', selected: [], custom: '你好' },
    ])
  })
})
