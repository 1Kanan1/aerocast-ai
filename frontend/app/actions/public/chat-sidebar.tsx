import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import type { ThreadEntry } from '../../ui/public/session.ts'
import { session } from '../../ui/public/session.ts'
import { AnswerView } from '../../ui/answer.tsx'

/** The persistent right column: one thread, shared with the station popup. */
export const ChatSidebar = clientEntry(
  import.meta.url,
  function ChatSidebar(handle: Handle) {
    session.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    return () => {
      let station = session.selected

      return (
        <div mix={sidebarStyle}>
          <header mix={headerStyle}>
            <span mix={titleStyle}>Explanation</span>
            <span mix={actionsStyle}>
              {station === null ? null : (
                <button
                  mix={[clearStyle, on('click', () => session.clear())]}
                  type="button"
                >
                  Clear
                </button>
              )}
              <button
                aria-label="Close explanation"
                mix={closeStyle}
                popovertarget="ai-drawer"
                popovertargetaction="hide"
                type="button"
              >
                ×
              </button>
            </span>
          </header>

          <div mix={threadStyle}>
            {station === null ? (
              <p mix={promptStyle}>
                Select a station on the map to ask about its weather. Answers
                restate the facts shown there and cite them.
              </p>
            ) : (
              <>
                <p mix={stationStyle}>
                  <strong>{station.icao}</strong> · {station.name}
                  {station.category === null ? '' : ` · ${station.category}`}
                </p>
                {station.thread.length === 0 ? (
                  <p mix={promptStyle}>
                    Nothing asked yet. The explanation layer may only describe
                    this station's facts.
                  </p>
                ) : (
                  station.thread.map((entry, index) => (
                    <Exchange entry={entry} key={`${entry.question}-${index}`} />
                  ))
                )}
              </>
            )}
          </div>

          <form
            mix={[
              composerStyle,
              on('submit', (event) => {
                event.preventDefault()
                let form = event.currentTarget
                let question = String(new FormData(form).get('question') ?? '')
                form.reset()
                void session.ask(question)
              }),
            ]}
          >
            <textarea
              maxLength={400}
              name="question"
              placeholder="Ask about the selected station"
              rows={2}
              disabled={station === null}
            />
            <button
              disabled={station === null}
              mix={askStyle}
              type="submit"
            >
              Ask
            </button>
          </form>

          <p mix={disclaimerStyle}>
            Generated explanation. It restates only the data shown on this page,
            cannot assess your aircraft or your ratings, and never makes a
            go/no-go call.
          </p>
        </div>
      )
    }
  },
)

function Exchange(handle: Handle<{ entry: ThreadEntry }>) {
  return () => {
    let { entry } = handle.props

    return (
      <article mix={exchangeStyle}>
        <p mix={questionStyle}>{entry.question}</p>
        {entry.pending ? (
          <p mix={pendingStyle}>Asking…</p>
        ) : (
          <AnswerView
            answer={entry.answer}
            problem={entry.problem}
            refusal={entry.refusal}
          />
        )}
      </article>
    )
  }
}

const sidebarStyle = css({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
  padding: '16px 18px',
  gap: '12px',
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '12px',
})

const actionsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
})

const closeStyle = css({
  width: '28px',
  height: '28px',
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'rgba(255, 255, 255, 0.04)',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-0)', background: 'rgba(255, 255, 255, 0.08)' },
})

const titleStyle = css({
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
})

const clearStyle = css({
  border: 0,
  background: 'none',
  padding: 0,
  color: 'var(--ink-3)',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
  textDecoration: 'underline',
})

const threadStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
})

const stationStyle = css({ margin: 0, fontSize: '13px' })

const promptStyle = css({ margin: 0, fontSize: '12px', color: 'var(--ink-3)' })

const composerStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  borderBlockStart: '1px solid var(--glass-border)',
  paddingBlockStart: '12px',
  '& textarea': {
    padding: '9px 11px',
    border: '1px solid var(--glass-border)',
    borderRadius: '14px',
    background: 'rgba(0, 0, 0, 0.28)',
    color: 'var(--ink-0)',
    font: 'inherit',
    resize: 'none',
  },
})

const askStyle = css({
  alignSelf: 'flex-end',
  padding: '7px 18px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '999px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  cursor: 'pointer',
  '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
})

const disclaimerStyle = css({
  margin: 0,
  paddingBlockStart: '10px',
  borderBlockStart: '1px solid var(--glass-border)',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const exchangeStyle = css({
  borderBlockEnd: '1px solid var(--glass-border)',
  paddingBlockEnd: '10px',
  '&:last-child': { borderBlockEnd: 0, paddingBlockEnd: 0 },
})

const questionStyle = css({
  margin: '0 0 6px',
  fontWeight: 700,
  fontSize: '12px',
})

const pendingStyle = css({ margin: 0, fontSize: '12px', color: 'var(--ink-3)' })
