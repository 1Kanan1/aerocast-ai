import type { Handle } from 'remix/component'
import { css, on, ref } from 'remix/component'

import type { ResolveStation } from '#app/lib/api-types.ts'
import type { ThreadEntry } from '#app/ui/public/session.ts'
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshIcon,
  SpeechIcon,
} from '#app/ui/public/icons.tsx'

export interface Suggestion {
  prompt: string
}

interface WelcomeProps {
  icao: string
  name: string
  category: string | null
  disabled: boolean
  onAsk: (prompt: string) => void
  suggestions: readonly Suggestion[]
}

/** The new-chat view: what this drawer can answer, and four ways in. */
export function ThreadWelcome(handle: Handle<WelcomeProps>) {
  return () => {
    let { icao, name, category, disabled, onAsk, suggestions } = handle.props

    return (
      <div mix={welcomeStyle}>
        <div mix={welcomeHeadStyle}>
          <p mix={welcomeKickerStyle}>Explanation layer</p>
          <h2 mix={welcomeTitleStyle}>Ask about {icao}</h2>
          <p mix={welcomeSubStyle}>
            {name}
            {category === null ? '' : ` · ${category}`} · answers cite the facts
            shown on the map
          </p>
        </div>

        <div mix={suggestionListStyle}>
          {suggestions.map((suggestion, index) => (
            <button
              disabled={disabled}
              mix={[
                suggestionStyle,
                on('click', () => onAsk(suggestion.prompt)),
              ]}
              style={{ animationDelay: `${80 + index * 55}ms` }}
              type="button"
            >
              <span aria-hidden="true" mix={suggestionMarkStyle}>
                ›
              </span>
              <span mix={suggestionTitleStyle}>{suggestion.prompt}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }
}

/** The stations a question might mean, as rows the reader can pick. */
export function ClarificationView(
  handle: Handle<{
    message: string | null
    onChoose: (icao: string) => void
    options: ResolveStation[]
  }>,
) {
  return () => (
    <div mix={clarifyStyle}>
      <p mix={clarifyLeadStyle}>
        {handle.props.message ?? 'Which station did you mean?'}
      </p>
      {handle.props.options.length === 0 ? null : (
        <div mix={optionListStyle}>
          {handle.props.options.map((option) => (
            <button
              key={option.icao}
              mix={[
                optionStyle,
                on('click', () => handle.props.onChoose(option.icao)),
              ]}
              type="button"
            >
              <span mix={optionCodeStyle}>{option.icao}</span>
              <span mix={optionNameStyle}>
                {option.name}
                {option.state === null ? '' : `, ${option.state}`}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A user turn: right aligned, compact, editable in place on the last one. */
export function UserTurn(
  handle: Handle<{ question: string; onEdit?: (next: string) => void }>,
) {
  let editing = false
  let draft = ''
  let field: HTMLTextAreaElement | undefined

  function startEdit(): void {
    draft = handle.props.question
    editing = true
    handle.update()
    handle.queueTask(() => {
      if (field === undefined) return
      field.value = draft
      field.style.height = 'auto'
      field.style.height = `${Math.min(field.scrollHeight, 132)}px`
      field.focus()
      field.select()
    })
  }

  function stopEdit(): void {
    editing = false
    handle.update()
  }

  function submit(): void {
    let next = draft.trim()
    if (next === '') {
      stopEdit()
      return
    }
    editing = false
    handle.props.onEdit?.(next)
  }

  return () => {
    return (
      <div mix={[userRowStyle, turnInStyle]}>
        {editing || handle.props.onEdit === undefined ? null : (
          <button
            aria-label="Edit question"
            mix={[editButtonStyle, on('click', startEdit)]}
            type="button"
          >
            <PencilIcon />
          </button>
        )}
        {editing ? (
          <form
            mix={[
              userEditStyle,
              on('submit', (event) => {
                event.preventDefault()
                submit()
              }),
            ]}
          >
            <textarea
              aria-label="Edit question"
              maxLength={400}
              name="question"
              mix={[
                ref((node) => (field = node)),
                on('input', (event) => {
                  draft = event.currentTarget.value
                  let node = event.currentTarget
                  node.style.height = 'auto'
                  node.style.height = `${Math.min(node.scrollHeight, 132)}px`
                  handle.update()
                }),
                on('keydown', (event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    stopEdit()
                    return
                  }
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  submit()
                }),
              ]}
              rows={1}
            />
            <div mix={userEditActionsStyle}>
              <button
                mix={[cancelEditStyle, on('click', stopEdit)]}
                type="button"
              >
                Cancel
              </button>
              <button
                disabled={draft.trim() === ''}
                mix={saveEditStyle}
                type="submit"
              >
                Send
              </button>
            </div>
          </form>
        ) : (
          <p mix={userBubbleStyle}>{handle.props.question}</p>
        )}
      </div>
    )
  }
}

/** An assistant turn: plain text, citations and any fallback notice. */
export function AssistantTurn(
  handle: Handle<{
    entry: ThreadEntry
    onRegenerate?: () => void
    showName?: boolean
  }>,
) {
  let copied = false
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  handle.signal.addEventListener('abort', () => clearTimeout(copiedTimer), {
    once: true,
  })

  function copy(): void {
    let answer = handle.props.entry.answer
    if (answer === null) return
    void writeClipboard(answer)
  }

  async function writeClipboard(
    answer: NonNullable<ThreadEntry['answer']>,
  ): Promise<void> {
    try {
      await navigator.clipboard.writeText(copyText(answer))
    } catch {
      return
    }

    copied = true
    handle.update()
    clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied = false
      handle.update()
    }, 1500)
  }

  return () => {
    let { entry } = handle.props

    return (
      <article mix={assistantStyle}>
        {handle.props.showName === false ? null : (
          <header mix={[assistantMetaStyle, turnInStyle]}>
            <span mix={assistantIconStyle}>
              <SpeechIcon />
            </span>
            AeroCast
          </header>
        )}

        {entry.pending ? (
          <p aria-live="polite" mix={pendingStyle} role="status">
            <span mix={pulseStyle} />
            Reading the observation…
          </p>
        ) : entry.stopped ? (
          <p mix={stoppedStyle}>Stopped.</p>
        ) : entry.refusal !== null ? (
          <div mix={[refusalStyle, turnInStyle]}>
            <p mix={bodyTextStyle}>{entry.refusal}</p>
            <p mix={refusalNoteStyle}>
              AeroCast explains weather. It does not decide whether a flight is
              safe.
            </p>
          </div>
        ) : entry.problem !== null ? (
          <p mix={[problemStyle, turnInStyle]}>{entry.problem}</p>
        ) : entry.answer === null ? null : (
          <div mix={[answerBodyStyle, turnInStyle]}>
            <RevealText text={entry.answer.summary} />
            {entry.answer.notice === null ? null : (
              <p mix={noticeStyle}>{entry.answer.notice}</p>
            )}
            {entry.answer.caveats.length === 0 ? null : (
              <ul mix={caveatsStyle}>
                {entry.answer.caveats.map((caveat) => (
                  <li key={caveat}>{caveat}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {entry.pending ? null : (
          <div mix={answerFooterStyle}>
            {entry.answer === null ? null : (
              <button
                aria-label={copied ? 'Copied' : 'Copy answer'}
                data-copy="true"
                mix={[turnActionStyle, on('click', copy)]}
                type="button"
              >
                {copied ? <CheckIcon /> : <CopyIcon />}
              </button>
            )}
            {handle.props.onRegenerate === undefined ? null : (
              <button
                aria-label="Regenerate response"
                mix={[
                  turnActionStyle,
                  on('click', () => handle.props.onRegenerate?.()),
                ]}
                type="button"
              >
                <RefreshIcon />
              </button>
            )}
          </div>
        )}
      </article>
    )
  }
}

/** Word-by-word reveal after the whole answer has already been validated. */
function RevealText(handle: Handle<{ text: string }>) {
  return () => {
    let words = handle.props.text.split(' ')

    return (
      <p mix={summaryStyle}>
        {words.map((word, index) => (
          <span key={`${word}-${index}`}>
            <span
              mix={wordStyle}
              style={{
                animationDelay: `${Math.min(index, 80) * 12}ms`,
              }}
            >
              {word}
            </span>{' '}
          </span>
        ))}
      </p>
    )
  }
}

function copyText(answer: NonNullable<ThreadEntry['answer']>): string {
  let parts = [answer.summary]
  if (answer.caveats.length > 0) {
    parts.push(answer.caveats.map((caveat) => `Note: ${caveat}`).join('\n'))
  }
  return parts.join('\n\n')
}

const turnInStyle = css({
  animation: 'rmx-thread-in 220ms ease-out both',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
})

const welcomeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '20px',
  marginBlock: 'auto',
  paddingBlock: '12px',
})

const welcomeHeadStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const welcomeKickerStyle = css({
  margin: 0,
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const welcomeTitleStyle = css({
  margin: 0,
  fontSize: '20px',
  fontWeight: 400,
  color: 'var(--ink-0)',
})

const welcomeSubStyle = css({
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const suggestionListStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const suggestionStyle = css({
  display: 'grid',
  gridTemplateColumns: '16px 1fr',
  columnGap: '8px',
  alignItems: 'center',
  width: '100%',
  padding: '10px 12px',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  background: 'rgba(255, 255, 255, 0.025)',
  color: 'var(--ink-1)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  animation: 'rmx-thread-in 220ms ease-out both',
  transition: 'background 120ms ease, border-color 120ms ease',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
  '&:hover': {
    background: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
})

const suggestionMarkStyle = css({
  fontSize: '15px',
  lineHeight: 1,
  color: 'var(--ink-3)',
})

const suggestionTitleStyle = css({ fontSize: '13px' })

const clarifyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
})

const clarifyLeadStyle = css({
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.55,
  color: 'var(--ink-0)',
})

const optionListStyle = css({
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  overflow: 'hidden',
  '& button + button': {
    borderBlockStart: '1px solid var(--glass-border)',
  },
})

const optionStyle = css({
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '10px',
  padding: '10px 12px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-0)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { background: 'rgba(255, 255, 255, 0.05)' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '-2px',
  },
})

const optionCodeStyle = css({ fontWeight: 700 })

const optionNameStyle = css({
  fontSize: '13px',
  color: 'var(--ink-2)',
})

const userRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '8px',
})

const editButtonStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '28px',
  height: '28px',
  flexShrink: 0,
  border: 0,
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--ink-3)',
  opacity: 0.55,
  cursor: 'pointer',
  transition: 'opacity 120ms ease, color 120ms ease',
  '&:hover': { opacity: 1, color: 'var(--ink-1)' },
  '&:focus-visible': { opacity: 1, color: 'var(--ink-1)' },
})

const userBubbleStyle = css({
  maxWidth: '86%',
  margin: 0,
  padding: '9px 12px',
  border: '1px solid rgba(255, 255, 255, 0.08)',
  borderRadius: '16px',
  background: 'rgba(255, 255, 255, 0.09)',
  fontSize: '13px',
  lineHeight: 1.55,
  color: 'var(--ink-0)',
  overflowWrap: 'anywhere',
})

const userEditStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  width: '86%',
  padding: '8px 10px 6px',
  border: '1px solid rgba(255, 255, 255, 0.2)',
  borderRadius: '16px',
  background: 'rgba(255, 255, 255, 0.06)',
  '& textarea': {
    width: '100%',
    minHeight: '34px',
    maxHeight: '132px',
    padding: '1px 2px 0',
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '13px',
    lineHeight: 1.55,
    resize: 'none',
    overflowY: 'auto',
  },
})

const userEditActionsStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '4px',
})

const cancelEditStyle = css({
  border: 0,
  borderRadius: '999px',
  padding: '4px 8px',
  background: 'none',
  color: 'var(--ink-3)',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-1)' },
})

const saveEditStyle = css({
  border: 0,
  borderRadius: '8px',
  padding: '4px 10px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
  '&:hover': { opacity: 0.9 },
  '&:disabled': { opacity: 0.3, cursor: 'not-allowed' },
})

const assistantStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const assistantMetaStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const assistantIconStyle = css({
  display: 'grid',
  placeItems: 'center',
  color: 'var(--ink-3)',
  '& svg': { width: '12px', height: '12px' },
})

const answerBodyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingInlineStart: '2px',
})

const summaryStyle = css({
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.65,
  color: 'var(--ink-0)',
})

const wordStyle = css({
  display: 'inline-block',
  animation: 'rmx-word-in 200ms ease-out both',
  '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
})

const noticeStyle = css({
  margin: 0,
  paddingInlineStart: '9px',
  borderInlineStart: '2px solid var(--glass-border)',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const caveatsStyle = css({
  margin: 0,
  paddingInlineStart: '16px',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const refusalStyle = css({
  padding: '10px 12px',
  border: '1px solid var(--accent)',
  borderRadius: '12px',
  background: 'rgba(224, 96, 63, 0.06)',
})

const refusalNoteStyle = css({
  margin: '6px 0 0',
  fontSize: '11px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const problemStyle = css({
  margin: 0,
  fontSize: '12px',
  color: 'var(--accent)',
})

const stoppedStyle = css({
  margin: 0,
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const answerFooterStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  marginBlockStart: '-6px',
})

const turnActionStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '22px',
  height: '22px',
  flexShrink: 0,
  marginBlockStart: '1px',
  padding: 0,
  border: 0,
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  outline: 'none',
  '&:hover': { color: 'var(--ink-1)' },
  '&:focus-visible': {
    outline: '1px solid var(--glass-border)',
    outlineOffset: '2px',
  },
})

const bodyTextStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.6,
})

const pendingStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: 0,
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const pulseStyle = css({
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: 'var(--accent)',
  animation: 'rmx-thread-pulse 1.1s ease-in-out infinite',
})
