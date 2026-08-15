import type { QuestionItem, PendingQuestion } from './events.ts'

export interface QuestionDraft {
  selected: string[]
  custom: string
}

/** Drafts are positional because question ids are opaque and may repeat. */
export type QuestionDrafts = Array<QuestionDraft | undefined>

export interface QuestionAnswer {
  id: string
  selected: string[]
  custom?: string
}

export function draftFor(drafts: QuestionDrafts, index: number): QuestionDraft {
  return drafts[index] ?? { selected: [], custom: '' }
}

export function toggleQuestionOption(
  drafts: QuestionDrafts,
  index: number,
  item: QuestionItem,
  label: string,
  checked: boolean,
): QuestionDrafts {
  const draft = draftFor(drafts, index)
  const selected = item.multiSelect === true
    ? checked
      ? [...new Set([...draft.selected, label])]
      : draft.selected.filter((candidate) => candidate !== label)
    : checked ? [label] : []
  return replaceDraft(drafts, index, {
    selected,
    custom: item.multiSelect === true ? draft.custom : '',
  })
}

export function setQuestionCustomAnswer(
  drafts: QuestionDrafts,
  index: number,
  item: QuestionItem,
  custom: string,
): QuestionDrafts {
  const draft = draftFor(drafts, index)
  return replaceDraft(drafts, index, {
    selected: item.multiSelect === true ? draft.selected : [],
    custom,
  })
}

/** Return the wire answers only when every question has a non-empty response. */
export function answersForQuestion(question: PendingQuestion, drafts: QuestionDrafts): QuestionAnswer[] | null {
  const answers: QuestionAnswer[] = []
  for (const [index, item] of question.questions.entries()) {
    const draft = draftFor(drafts, index)
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

function replaceDraft(drafts: QuestionDrafts, index: number, draft: QuestionDraft): QuestionDrafts {
  const next = drafts.slice()
  next[index] = draft
  return next
}
