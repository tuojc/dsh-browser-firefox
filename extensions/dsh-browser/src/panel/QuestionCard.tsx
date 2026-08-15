import { useState } from 'react'
import type { PendingQuestion, QuestionItem } from './events.ts'
import {
  answersForQuestion,
  draftFor,
  setQuestionCustomAnswer,
  toggleQuestionOption,
  type QuestionAnswer,
  type QuestionDrafts,
} from './questions.ts'
import type { PanelCopy } from './strings.ts'

export function QuestionCard({
  question,
  copy,
  submitting,
  onAnswer,
  onDismiss,
}: {
  question: PendingQuestion
  copy: PanelCopy
  submitting: boolean
  onAnswer: (answers: QuestionAnswer[]) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<QuestionDrafts>({})
  const answers = answersForQuestion(question, drafts)

  return (
    <section className="question-card" aria-labelledby="question-card-title" aria-live="polite">
      <header className="question-heading">
        <span className="question-mark" aria-hidden="true">?</span>
        <div>
          <span className="eyebrow">{copy.question.eyebrow}</span>
          <h2 id="question-card-title">{copy.question.title}</h2>
        </div>
      </header>
      <div className="question-list">
        {question.questions.map((item, index) => (
          <QuestionItemView
            key={item.id}
            item={item}
            index={index}
            count={question.questions.length}
            drafts={drafts}
            disabled={submitting}
            copy={copy}
            onToggle={(label, checked) => { setDrafts((current) => toggleQuestionOption(current, item, label, checked)) }}
            onCustom={(value) => { setDrafts((current) => setQuestionCustomAnswer(current, item, value)) }}
          />
        ))}
      </div>
      <div className="question-actions">
        <button className="secondary" onClick={onDismiss} disabled={submitting}>{copy.question.dismiss}</button>
        <button className="primary" onClick={() => { if (answers !== null) onAnswer(answers) }} disabled={submitting || answers === null}>
          {submitting ? copy.question.answering : copy.question.answer}
        </button>
      </div>
    </section>
  )
}

function QuestionItemView({
  item,
  index,
  count,
  drafts,
  disabled,
  copy,
  onToggle,
  onCustom,
}: {
  item: QuestionItem
  index: number
  count: number
  drafts: QuestionDrafts
  disabled: boolean
  copy: PanelCopy
  onToggle: (label: string, checked: boolean) => void
  onCustom: (value: string) => void
}): React.JSX.Element {
  const draft = draftFor(drafts, item.id)
  const multi = item.multiSelect === true
  return (
    <fieldset className="question-item" disabled={disabled}>
      <legend>
        {count > 1 && <span className="question-index">{index + 1}</span>}
        <span className="question-copy">
          {item.header !== undefined && item.header !== '' && <span className="question-header">{item.header}</span>}
          <strong>{item.question}</strong>
          {item.detail !== undefined && item.detail !== '' && <small>{item.detail}</small>}
        </span>
      </legend>
      {item.options !== undefined && item.options.length > 0 && (
        <div className="question-options">
          {item.options.map((option) => {
            const checked = draft.selected.includes(option.label)
            return (
              <label key={option.label} className={`question-option ${checked ? 'checked' : ''}`}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`question-${item.id}`}
                  checked={checked}
                  onChange={(event) => { onToggle(option.label, event.target.checked) }}
                />
                <span>
                  <strong>{option.label}</strong>
                  {option.description !== undefined && option.description !== '' && <small>{option.description}</small>}
                </span>
              </label>
            )
          })}
        </div>
      )}
      <input
        className="question-custom"
        type="text"
        value={draft.custom}
        placeholder={item.options !== undefined && item.options.length > 0 ? copy.question.customAlternative : copy.question.customAnswer}
        aria-label={copy.question.customAnswer}
        onChange={(event) => { onCustom(event.target.value) }}
      />
    </fieldset>
  )
}
