import type { Handle } from 'remix/component'
import { css, on, ref } from 'remix/component'

import type { Claim } from '#app/lib/answer.ts'
import type { ResolveCandidate } from '#app/lib/api-types.ts'
import { modelLabel, tookLabel } from '#app/lib/format.ts'
import { reportLabel } from '#app/lib/public/labels.ts'
import {
  THINKING_CYCLE_MS,
  THINKING_LABEL,
  THINKING_LETTERS,
  thinkingDelay,
} from '#app/ui/public/thinking-wave.ts'
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

const METAR_FIELD_LABELS: Record<string, string> = {
  flight_category: 'category',
  wind: 'wind',
  visibility: 'visibility',
  ceiling: 'ceiling',
  temperature: 'temp',
  humidity: 'humidity',
}

/** Human-readable chip label for a bundle ref such as `metar.KSFO.wind`. */
export function citationLabel(refPath: string): string {
  let parts = refPath.split('.')
  let kind = parts[0]
  let icao = parts[1]
  if (kind === 'metar' && icao) {
    let field = parts[2]
    if (!field) return `${icao} METAR`
    return `${icao} ${METAR_FIELD_LABELS[field] ?? field.replace(/_/g, ' ')}`
  }
  if (kind === 'taf' && icao) {
    if (parts[2] === 'history') return `${icao} TAF history`
    if (parts[2] === 'period' && parts[3] !== undefined) {
      let index = Number(parts[3])
      return Number.isFinite(index)
        ? `${icao} TAF #${index + 1}`
        : `${icao} TAF`
    }
    return `${icao} TAF`
  }
  if (kind === 'history' && icao) {
    return `${icao} history`
  }
  if (kind === 'adv' && icao) {
    let index = Number(parts[2])
    return Number.isFinite(index)
      ? `${icao} advisory #${index + 1}`
      : `${icao} advisory`
  }
  if (kind === 'area' && icao === 'summary') {
    return 'Area summary'
  }
  if (kind === 'definitions' && icao) {
    return `${icao.replace(/_/g, ' ')} definition`
  }
  if (kind === 'station' && icao) {
    return `${icao} station`
  }
  return refPath
}

export interface CitationTarget {
  section: 'conditions' | 'forecast'
  field: string | null
}

/** Maps a bundle ref to the panel section and fact key it points to. */
export function citationTarget(refPath: string): CitationTarget {
  let parts = refPath.split('.')
  if (parts[0] === 'taf') {
    return { section: 'forecast', field: refPath }
  }
  if (parts[0] === 'adv') {
    return { section: 'conditions', field: 'advisories' }
  }
  if (parts[0] === 'history') {
    return { section: 'conditions', field: 'history' }
  }
  if (parts[0] === 'metar') {
    return { section: 'conditions', field: parts[2] ?? null }
  }
  return { section: 'conditions', field: null }
}

/** Unique citation refs in order, paired with the first claim text for title context. */
export function collectCitations(
  claims: readonly Claim[],
): Array<{ ref: string; note: string }> {
  let seen = new Set<string>()
  let result: Array<{ ref: string; note: string }> = []
  for (let claim of claims) {
    for (let item of claim.refs) {
      if (seen.has(item)) continue
      seen.add(item)
      result.push({ ref: item, note: claim.text })
    }
  }
  return result
}

/** The new-chat view: what this drawer can answer, and starter prompts. */
export function ThreadWelcome(handle: Handle<WelcomeProps>) {
  return () => {
    let { icao, name, category, disabled, onAsk, suggestions } = handle.props

    return (
      <div mix={welcomeStyle}>
        <div mix={welcomeHeadStyle}>
          <h2 mix={welcomeTitleStyle}>Ask about {icao}</h2>
          <p mix={welcomeSubStyle}>
            {name}
            {category === null ? '' : ` · ${category}`} · answers cite the facts
            shown in Conditions and Forecast
          </p>
        </div>

        <div mix={suggestionListStyle}>
          {suggestions.slice(0, 4).map((suggestion, index) => (
            <button
              key={suggestion.prompt}
              disabled={disabled}
              mix={[
                suggestionStyle,
                on('click', () => onAsk(suggestion.prompt)),
              ]}
              style={{ animationDelay: `${50 + index * 45}ms` }}
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
    options: ResolveCandidate[]
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
              <span mix={optionTextStyle}>
                <span mix={optionNameStyle}>
                  {option.name}
                  {option.state === null ? '' : `, ${option.state}`}
                </span>
                <span mix={optionFactsStyle}>
                  {option.metar === null
                    ? 'no observation on file'
                    : reportLabel(option.metar)}
                </span>
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

  return () => (
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
            data-focus-ring="parent"
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
                  event.stopPropagation()
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

/** An assistant turn: plain text, interactive citations, and any fallback notice. */
export function AssistantTurn(
  handle: Handle<{
    entry: ThreadEntry
    onRegenerate?: () => void
    onSelectRef?: (refPath: string) => void
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
    let { entry, onSelectRef } = handle.props
    let citations =
      entry.answer === null ? [] : collectCitations(entry.answer.claims)

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
          <p mix={pendingStyle}>
            <span aria-hidden="true" mix={pulseStyle} />
            <span mix={thinkingStyle}>
              {THINKING_LETTERS.map((letter, index) => (
                <span
                  key={index}
                  mix={thinkingLetterStyle}
                  style={{ animationDelay: thinkingDelay(index) }}
                >
                  {letter}
                </span>
              ))}
            </span>
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
            <p mix={summaryStyle}>{entry.answer.summary}</p>
            {citations.length === 0 ? null : (
              <div aria-label="Cited facts" mix={citationsStyle} role="group">
                {citations.map((item) =>
                  onSelectRef ? (
                    <button
                      key={item.ref}
                      mix={[
                        citationChipStyle,
                        citationButtonStyle,
                        on('click', () => onSelectRef(item.ref)),
                      ]}
                      title={item.note}
                      type="button"
                    >
                      {citationLabel(item.ref)}
                    </button>
                  ) : (
                    <span
                      key={item.ref}
                      mix={citationChipStyle}
                      title={item.note}
                    >
                      {citationLabel(item.ref)}
                    </span>
                  ),
                )}
              </div>
            )}
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
            {entry.answer === null ? null : (
              <AnswerCredit answer={entry.answer} />
            )}
          </div>
        )}
      </article>
    )
  }
}

/** What a turn says out loud: the latest one is the live region's text. */
export function threadAnnouncement(entry: ThreadEntry | undefined): string {
  if (entry === undefined) return ''
  if (entry.pending) return THINKING_LABEL
  if (entry.stopped) return 'Stopped.'
  if (entry.refusal !== null) return entry.refusal
  if (entry.problem !== null) return entry.problem
  return entry.answer?.summary ?? ''
}

export function ThreadAnnouncer(
  handle: Handle<{ thread: readonly ThreadEntry[] }>,
) {
  return () => (
    <p aria-atomic="true" aria-live="polite" mix={srOnlyStyle}>
      {threadAnnouncement(handle.props.thread[handle.props.thread.length - 1])}
    </p>
  )
}

function AnswerCredit(
  handle: Handle<{ answer: NonNullable<ThreadEntry['answer']> }>,
) {
  return () => {
    let { model, elapsedMs } = handle.props.answer
    if (model === null) return null

    return (
      <p mix={creditStyle}>
        {modelLabel(model)}
        {elapsedMs === null ? '' : ` · ${tookLabel(elapsedMs)}`}
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
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-thread-in 240ms var(--ease-out) both',
  },
})

const welcomeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
  paddingBlock: '6px',
})

const welcomeHeadStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
})

const welcomeTitleStyle = css({
  margin: 0,
  fontSize: '18px',
  fontWeight: 600,
  color: 'var(--ink-0)',
})

const welcomeSubStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})

const suggestionListStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const suggestionStyle = css({
  display: 'grid',
  gridTemplateColumns: '14px 1fr',
  columnGap: '8px',
  alignItems: 'center',
  width: '100%',
  minHeight: '42px',
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: '11px',
  background: 'var(--paper)',
  color: 'var(--ink-1)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition:
    'background 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 160ms var(--ease-out)',
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-thread-in 240ms var(--ease-out) both',
  },
  '&:hover': {
    background: 'var(--hover-bg)',
    borderColor: 'var(--line-strong)',
    transform: 'translateX(2px)',
  },
  '&:active': { transform: 'scale(0.99)' },
  '&:disabled': { opacity: 0.45, cursor: 'not-allowed', transform: 'none' },
})

const suggestionMarkStyle = css({
  fontSize: '15px',
  lineHeight: 1,
  color: 'var(--ink-3)',
})

const suggestionTitleStyle = css({ fontSize: '13px', lineHeight: 1.4 })

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
  border: '1px solid var(--line)',
  borderRadius: '12px',
  overflow: 'hidden',
  '& button + button': {
    borderBlockStart: '1px solid var(--line)',
  },
})

const optionStyle = css({
  display: 'grid',
  gridTemplateColumns: '4.5rem 1fr',
  gap: '10px',
  minHeight: '44px',
  padding: '10px 12px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-0)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'background 150ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)' },
  '&:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '-2px',
  },
})

const optionCodeStyle = css({
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
})

const optionTextStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
})

const optionNameStyle = css({
  fontSize: '13px',
  color: 'var(--ink-1)',
})

const optionFactsStyle = css({
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
})

const userRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: '6px',
})

const editButtonStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  flexShrink: 0,
  border: 0,
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  transition:
    'background 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)', color: 'var(--ink-0)' },
  '&:active': { transform: 'scale(0.92)' },
})

const userBubbleStyle = css({
  maxWidth: '86%',
  margin: 0,
  padding: '9px 13px',
  border: '1px solid var(--line)',
  borderRadius: '14px',
  background: 'var(--paper-3)',
  fontSize: '13px',
  lineHeight: 1.55,
  color: 'var(--ink-0)',
  overflowWrap: 'anywhere',
})

const userEditStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  width: '86%',
  padding: '8px 10px 6px',
  border: '1px solid var(--line-strong)',
  borderRadius: '14px',
  background: 'var(--paper)',
  '&:has(textarea:focus-visible)': {
    outline: '2px solid var(--focus-ring)',
    outlineOffset: '2px',
  },
  '& textarea': {
    width: '100%',
    minHeight: '36px',
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
  gap: '6px',
})

const cancelEditStyle = css({
  border: 0,
  borderRadius: '8px',
  padding: '6px 10px',
  background: 'none',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  transition: 'background 150ms var(--ease-out), color 150ms var(--ease-out)',
  '&:hover': { color: 'var(--ink-0)', background: 'var(--hover-bg)' },
})

const saveEditStyle = css({
  border: 0,
  borderRadius: '8px',
  padding: '6px 12px',
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 140ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': { opacity: 0.92 },
  '&:active': { transform: 'scale(0.96)' },
  '&:disabled': { opacity: 0.35, cursor: 'not-allowed', transform: 'none' },
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
  fontSize: '12px',
  fontWeight: 500,
  color: 'var(--ink-2)',
})

const assistantIconStyle = css({
  display: 'grid',
  placeItems: 'center',
  color: 'var(--ink-2)',
  '& svg': { width: '13px', height: '13px' },
})

const answerBodyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const summaryStyle = css({
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.6,
  color: 'var(--ink-0)',
})

const citationsStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px',
})

const citationChipStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 8px',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 500,
  lineHeight: 1.3,
})

const citationButtonStyle = css({
  cursor: 'pointer',
  transition:
    'border-color 150ms var(--ease-out), transform 140ms var(--ease-spring)',
  '&:hover': {
    borderColor: 'var(--accent)',
    transform: 'translateY(-1px)',
  },
  '&:active': { transform: 'scale(0.96)' },
})

const noticeStyle = css({
  margin: 0,
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--paper)',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})

const caveatsStyle = css({
  margin: 0,
  paddingInlineStart: '18px',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})

const refusalStyle = css({
  padding: '10px 12px',
  border: '1px solid var(--warn-border)',
  borderRadius: '10px',
  background: 'var(--warn-bg)',
})

const refusalNoteStyle = css({
  margin: '6px 0 0',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})

const problemStyle = css({
  margin: 0,
  padding: '8px 10px',
  border: '1px solid var(--danger-border)',
  borderRadius: '8px',
  background: 'var(--danger-bg)',
  fontSize: '12px',
  color: 'var(--danger-ink)',
})

const stoppedStyle = css({
  margin: 0,
  fontSize: '12px',
  color: 'var(--ink-2)',
})

const answerFooterStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  marginBlockStart: '-2px',
})

const creditStyle = css({
  margin: 0,
  marginInlineStart: '4px',
  fontSize: '11px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
})

const turnActionStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  flexShrink: 0,
  padding: 0,
  border: 0,
  borderRadius: '8px',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  transition:
    'background 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)', color: 'var(--ink-0)' },
  '&:active': { transform: 'scale(0.92)' },
})

const bodyTextStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.55,
})

const srOnlyStyle = css({
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  clipPath: 'inset(50%)',
  whiteSpace: 'nowrap',
})

const pendingStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  margin: 0,
  fontSize: '12px',
  color: 'var(--ink-2)',
})

const thinkingStyle = css({
  display: 'inline-flex',
  whiteSpace: 'nowrap',
})

const thinkingLetterStyle = css({
  '@media (prefers-reduced-motion: no-preference)': {
    animation: `rmx-thinking-wave ${THINKING_CYCLE_MS}ms ease-in-out infinite`,
  },
})

const pulseStyle = css({
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: 'var(--accent)',
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-thread-pulse 1.1s ease-in-out infinite',
  },
})
