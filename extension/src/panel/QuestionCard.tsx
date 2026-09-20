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

/**
 * ask_user_question 卡片：宿主瀑布被桥认领后，用户在侧边栏直接回答，
 * 不必切到 dsh web。多题按顺序排列；每题可用选项（单/多选）或自定义文本，
 * 全部非空才能提交。
 */
export function QuestionCard({
  question,
  submitting,
  onAnswer,
  onDismiss,
}: {
  question: PendingQuestion
  submitting: boolean
  onAnswer: (answers: QuestionAnswer[]) => void
  onDismiss: () => void
}): React.JSX.Element {
  const [drafts, setDrafts] = useState<QuestionDrafts>([])
  const answers = answersForQuestion(question, drafts)

  return (
    <section className="question-card" aria-labelledby="question-card-title" aria-live="polite">
      <header className="question-heading">
        <span className="question-mark" aria-hidden="true">?</span>
        <div>
          <span className="eyebrow">等待你的回答</span>
          <h2 id="question-card-title">助手需要你确认</h2>
        </div>
      </header>
      <div className="question-list">
        {question.questions.map((item, index) => (
          <QuestionItemView
            key={index}
            item={item}
            index={index}
            count={question.questions.length}
            drafts={drafts}
            disabled={submitting}
            onToggle={(label, checked) => { setDrafts((current) => toggleQuestionOption(current, index, item, label, checked)) }}
            onCustom={(value) => { setDrafts((current) => setQuestionCustomAnswer(current, index, item, value)) }}
          />
        ))}
      </div>
      <div className="question-actions">
        <button className="secondary" onClick={onDismiss} disabled={submitting}>放弃</button>
        <button className="primary" onClick={() => { if (answers !== null) onAnswer(answers) }} disabled={submitting || answers === null}>
          {submitting ? '回答中…' : '回答'}
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
  onToggle,
  onCustom,
}: {
  item: QuestionItem
  index: number
  count: number
  drafts: QuestionDrafts
  disabled: boolean
  onToggle: (label: string, checked: boolean) => void
  onCustom: (value: string) => void
}): React.JSX.Element {
  const draft = draftFor(drafts, index)
  const multi = item.multiSelect === true
  const options = item.options
  const hasOptions = options !== undefined && options.length > 0
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
      {options !== undefined && options.length > 0 && (
        <div className="question-options">
          {options.map((option, optionIndex) => {
            const checked = draft.selected.includes(option.label)
            return (
              <label key={optionIndex} className={`question-option ${checked ? 'checked' : ''}`}>
                <input
                  type={multi ? 'checkbox' : 'radio'}
                  name={`question-${index}`}
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
        placeholder={hasOptions ? '或输入其他答案' : '输入你的答案'}
        aria-label="输入你的答案"
        onChange={(event) => { onCustom(event.target.value) }}
      />
    </fieldset>
  )
}
