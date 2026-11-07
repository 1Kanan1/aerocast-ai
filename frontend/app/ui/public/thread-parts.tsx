import type { Handle } from 'remix/component'
import { css, on } from 'remix/component'

import type { ThreadEntry } from '#app/ui/public/session.ts'
import { SparkIcon } from '#app/ui/public/icons.tsx'

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

/** A user turn: right aligned, compact, no assistant chrome. */
export function UserTurn(handle: Handle<{ question: string }>) {
  return () => (
    <div mix={userRowStyle}>
      <p mix={[userBubbleStyle, turnInStyle]}>{handle.props.question}</p>
    </div>
  )
}

/** An assistant turn: plain text, citations and any fallback notice. */
export function AssistantTurn(handle: Handle<{ entry: ThreadEntry }>) {
  return () => {
    let { entry } = handle.props

    return (
      <article mix={assistantStyle}>
        <header mix={[assistantMetaStyle, turnInStyle]}>
          <span mix={assistantIconStyle}>
            <SparkIcon />
          </span>
          AeroCast
        </header>

        {entry.pending ? (
          <p aria-live="polite" mix={pendingStyle} role="status">
            <span mix={pulseStyle} />
            Reading the observation…
          </p>
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
            {entry.answer.notice === null ? null : (
              <p mix={noticeStyle}>{entry.answer.notice}</p>
            )}
            {entry.answer.claims.length === 0 ? null : (
              <ul mix={claimsStyle}>
                {entry.answer.claims.map((claim) => (
                  <li key={claim.text} mix={claimStyle}>
                    <p mix={claimTextStyle}>{claim.text}</p>
                    <span mix={refsStyle}>
                      {claim.refs.map((ref) => (
                        <code key={ref} mix={refStyle}>
                          {ref}
                        </code>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
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
      </article>
    )
  }
}

const turnInStyle = css({
  animation: 'rmx-thread-in 220ms ease-out both',
})

const welcomeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '18px',
  marginBlock: 'auto',
  paddingBlock: '12px',
})

const welcomeHeadStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
})

const welcomeKickerStyle = css({
  margin: 0,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
})

const welcomeTitleStyle = css({
  margin: 0,
  fontSize: '21px',
  fontWeight: 600,
  letterSpacing: '-0.01em',
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
  gap: '7px',
})

const suggestionStyle = css({
  display: 'grid',
  gridTemplateColumns: '14px 1fr',
  columnGap: '9px',
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
  '&:hover': {
    background: 'rgba(255, 255, 255, 0.06)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
  },
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
})

const suggestionMarkStyle = css({
  fontSize: '15px',
  lineHeight: 1,
  color: 'var(--accent)',
})

const suggestionTitleStyle = css({ fontSize: '13px' })

const userRowStyle = css({
  display: 'flex',
  justifyContent: 'flex-end',
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

const assistantStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const assistantMetaStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  fontSize: '10px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const assistantIconStyle = css({
  display: 'grid',
  placeItems: 'center',
  color: 'var(--accent)',
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

const noticeStyle = css({
  margin: 0,
  paddingInlineStart: '9px',
  borderInlineStart: '2px solid var(--glass-border)',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const claimsStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
})

const claimStyle = css({
  padding: '8px 10px',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  background: 'rgba(0, 0, 0, 0.18)',
})

const claimTextStyle = css({
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.55,
  color: 'var(--ink-1)',
})

const refsStyle = css({
  display: 'flex',
  flexWrap: 'wrap',
  gap: '4px',
  marginBlockStart: '6px',
})

const refStyle = css({
  padding: '1px 5px',
  border: '1px solid var(--glass-border)',
  borderRadius: '5px',
  fontSize: '10px',
  color: 'var(--ink-3)',
  fontFamily: 'inherit',
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
