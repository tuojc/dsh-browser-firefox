// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { PendingQuestion } from '../src/panel/events.ts'
import {
  answersForQuestion,
  setQuestionCustomAnswer,
  toggleQuestionOption,
  type QuestionDrafts,
} from '../src/panel/questions.ts'

const QUESTION: PendingQuestion = {
  rpcId: 'rpc',
  sessionId: 'session',
  questions: [
    { id: 'single', question: 'Pick one', options: [{ label: 'A' }, { label: 'B' }] },
    { id: 'multi', question: 'Pick several', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
  ],
}

describe('question answers', () => {
  it('requires an answer for every item and serializes selected options', () => {
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    expect(answersForQuestion(QUESTION, drafts)).toBeNull()
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'X', true)
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'Y', true)
    expect(answersForQuestion(QUESTION, drafts)).toEqual([
      { id: 'single', selected: ['A'] },
      { id: 'multi', selected: ['X', 'Y'] },
    ])
  })

  it('uses custom text for single choice and preserves selections for multi-choice', () => {
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 0, QUESTION.questions[0]!, 'A', true)
    drafts = setQuestionCustomAnswer(drafts, 0, QUESTION.questions[0]!, '  another option  ')
    drafts = setQuestionCustomAnswer(drafts, 1, QUESTION.questions[1]!, 'plus this')
    drafts = toggleQuestionOption(drafts, 1, QUESTION.questions[1]!, 'X', true)
    expect(answersForQuestion(QUESTION, drafts)).toEqual([
      { id: 'single', selected: [], custom: 'another option' },
      { id: 'multi', selected: ['X'], custom: 'plus this' },
    ])
  })

  it('keeps duplicate and prototype-like ids isolated by question position', () => {
    const question: PendingQuestion = {
      rpcId: 'special-ids',
      sessionId: 'session',
      questions: [
        { id: 'constructor', question: '', options: [{ label: '' }] },
        { id: 'constructor', question: 'Repeated id' },
        { id: '__proto__', question: 'Prototype id' },
      ],
    }
    let drafts: QuestionDrafts = []
    drafts = toggleQuestionOption(drafts, 0, question.questions[0]!, '', true)
    drafts = setQuestionCustomAnswer(drafts, 1, question.questions[1]!, 'second')
    drafts = setQuestionCustomAnswer(drafts, 2, question.questions[2]!, 'third')
    expect(answersForQuestion(question, drafts)).toEqual([
      { id: 'constructor', selected: [''] },
      { id: 'constructor', selected: [], custom: 'second' },
      { id: '__proto__', selected: [], custom: 'third' },
    ])
  })
})
