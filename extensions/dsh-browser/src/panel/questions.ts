import type { QuestionItem, PendingQuestion } from './events.ts'

export interface QuestionDraft {
  selected: string[]
  custom: string
}

export type QuestionDrafts = Record<string, QuestionDraft>

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export function draftFor(drafts: QuestionDrafts, id: string): QuestionDraft {
  return drafts[id] ?? { selected: [], custom: '' }
}

export function toggleQuestionOption(
  drafts: QuestionDrafts,
  item: QuestionItem,
  label: string,
  checked: boolean,
): QuestionDrafts {
  const draft = draftFor(drafts, item.id)
  const selected = item.multiSelect === true
    ? checked
      ? [...new Set([...draft.selected, label])]
      : draft.selected.filter((candidate) => candidate !== label)
    : checked ? [label] : []
  return { ...drafts, [item.id]: { selected, custom: '' } }
}

export function setQuestionCustomAnswer(
  drafts: QuestionDrafts,
  item: QuestionItem,
  custom: string,
): QuestionDrafts {
  const draft = draftFor(drafts, item.id)
  return {
    ...drafts,
    [item.id]: {
      selected: item.multiSelect === true ? draft.selected : [],
      custom,
    },
  }
}

/** Return the wire answers only when every question has a non-empty response. */
export function answersForQuestion(question: PendingQuestion, drafts: QuestionDrafts): QuestionAnswer[] | null {
  const answers: QuestionAnswer[] = []
  for (const item of question.questions) {
    const draft = draftFor(drafts, item.id)
    const custom = draft.custom.trim()
    if (draft.selected.length === 0 && custom === '') return null
    answers.push({
      id: item.id,
      selected: draft.selected,
      ...(custom === '' ? {} : { custom }),
    })
  }
  return answers
}
