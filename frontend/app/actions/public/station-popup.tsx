import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { ageLabel } from '../../lib/format.ts'
import {
  ceilingLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from '../../lib/public/labels.ts'
import { routes } from '../../routes.ts'
import { session } from '../../ui/public/session.ts'
import { AnswerView } from '../../ui/answer.tsx'

/** The floating station card, with its composer pinned to its bottom edge. */
export const StationPopup = clientEntry(
  import.meta.url,
  function StationPopup(handle: Handle) {
    session.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    return () => {
      let station = session.selected
      let facts = station?.facts ?? null
      let latest = station?.thread.at(-1) ?? null

      return (
        <div
          mix={hostStyle}
          style={{ display: station === null ? 'none' : 'flex' }}
        >
          {station === null ? null : (
            <>
              <header mix={headerStyle}>
                <div>
                  <span mix={icaoStyle}>{station.icao}</span>
                  <span mix={nameStyle}>{station.name}</span>
                </div>
                <button
                  aria-label="Close station panel"
                  mix={[closeStyle, on('click', () => session.clear())]}
                  type="button"
                >
                  ×
                </button>
              </header>

              <div mix={bodyStyle}>
                {station.loading ? (
                  <p mix={mutedStyle}>Loading station facts…</p>
                ) : station.error !== null ? (
                  <p mix={mutedStyle}>{station.error}</p>
                ) : (
                  <>
                    <p mix={categoryStyle}>
                      {station.category ?? 'no category'}
                      {station.basis === null ? '' : ` · ${station.basis}`}
                    </p>

                    <p mix={ageStyle}>
                      Observed {ageLabel(station.ageSeconds)}
                      {station.stale ? (
                        <span mix={staleStyle}>stale</span>
                      ) : null}
                    </p>

                    {facts === null ? (
                      <p mix={mutedStyle}>No observation on file.</p>
                    ) : (
                      <>
                        <dl mix={factsStyle}>
                          <Fact label="Wind" value={windLabel(facts)} />
                          <Fact label="Visibility" value={visibilityLabel(facts)} />
                          <Fact label="Ceiling" value={ceilingLabel(facts)} />
                          <Fact
                            label="Temperature"
                            value={temperatureLabel(facts)}
                          />
                        </dl>
                        <code mix={rawStyle}>{facts.raw}</code>
                      </>
                    )}

                    <p mix={mutedStyle}>
                      {station.advisories === 0
                        ? 'No active advisories within 50 nm.'
                        : `${station.advisories} active ${
                            station.advisories === 1 ? 'advisory' : 'advisories'
                          } within 50 nm.`}
                    </p>

                    {latest === null ? null : (
                      <div mix={exchangeStyle}>
                        <p mix={questionStyle}>{latest.question}</p>
                        {latest.pending ? (
                          <p mix={mutedStyle}>Asking…</p>
                        ) : (
                          <AnswerView
                            answer={latest.answer}
                            problem={latest.problem}
                            refusal={latest.refusal}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <footer mix={footerStyle}>
                <a mix={pageLinkStyle} href={routes.station.href({ icao: station.icao })}>
                  Open full page →
                </a>
                <form
                  mix={[
                    composerStyle,
                    on('submit', (event) => {
                      event.preventDefault()
                      let form = event.currentTarget
                      let question = String(
                        new FormData(form).get('question') ?? '',
                      )
                      form.reset()
                      void session.ask(question)
                    }),
                  ]}
                >
                  <input
                    aria-label="Ask about this station"
                    maxLength={400}
                    name="question"
                    placeholder="Ask about this station"
                    type="text"
                  />
                  <button mix={askStyle} type="submit">
                    Ask
                  </button>
                </form>
              </footer>
            </>
          )}
        </div>
      )
    }
  },
)

function Fact(handle: Handle<{ label: string; value: string }>) {
  return () => (
    <div mix={factStyle}>
      <dt>{handle.props.label}</dt>
      <dd>{handle.props.value}</dd>
    </div>
  )
}

const hostStyle = css({
  position: 'absolute',
  top: '84px',
  left: '16px',
  zIndex: 3,
  width: 'min(340px, calc(100% - 32px))',
  maxHeight: 'calc(100% - 100px)',
  flexDirection: 'column',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
  boxShadow: '0 12px 32px rgba(10, 10, 10, 0.12)',
  overflow: 'hidden',
  '@media (max-width: 700px)': {
    top: 'auto',
    bottom: '12px',
    left: '12px',
    width: 'calc(100% - 24px)',
    maxHeight: '60%',
  },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '10px 12px',
  borderBlockEnd: '1px solid var(--line)',
})

const icaoStyle = css({ fontWeight: 700, letterSpacing: '0.04em' })

const nameStyle = css({
  display: 'block',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const closeStyle = css({
  border: 0,
  background: 'none',
  padding: '0 4px',
  color: 'var(--ink-3)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  '& > p': { margin: 0 },
})

const categoryStyle = css({ fontSize: '12px', fontWeight: 700 })

const ageStyle = css({ fontSize: '11px', color: 'var(--ink-3)' })

const staleStyle = css({
  marginInlineStart: '6px',
  padding: '0 5px',
  border: '1px solid var(--accent)',
  borderRadius: '4px',
  color: 'var(--accent)',
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '6px 12px',
  margin: 0,
})

const factStyle = css({
  margin: 0,
  '& dt': {
    fontSize: '10px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
  },
  '& dd': { margin: 0, fontSize: '12px' },
})

const rawStyle = css({
  display: 'block',
  padding: '6px 8px',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  fontSize: '11px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

const mutedStyle = css({ fontSize: '12px', color: 'var(--ink-3)' })

const exchangeStyle = css({
  borderBlockStart: '1px solid var(--line)',
  paddingBlockStart: '8px',
})

const questionStyle = css({
  margin: '0 0 4px',
  fontSize: '12px',
  fontWeight: 700,
})

const footerStyle = css({
  borderBlockStart: '1px solid var(--line)',
  padding: '8px 12px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const pageLinkStyle = css({
  fontSize: '11px',
  color: 'var(--ink-2)',
})

const composerStyle = css({
  display: 'flex',
  gap: '6px',
  '& input': {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '6px 8px',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    background: 'var(--paper)',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '12px',
  },
})

const askStyle = css({
  padding: '6px 12px',
  border: '1px solid var(--ink-0)',
  borderRadius: '6px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
})
