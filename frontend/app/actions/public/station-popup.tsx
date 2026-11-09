import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import { ageLabel, timeLabel, windowLabel } from '#app/lib/format.ts'
import {
  ceilingLabel,
  periodWindLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from '#app/lib/public/labels.ts'
import { type Anchor, session } from '#app/ui/public/session.ts'
import type { SelectedStation } from '#app/ui/public/session.ts'
import { Timeline, timelinePoints } from '#app/ui/timeline.tsx'

const CARD_GAP = 16
const CARD_PAD = 12
const NAVBAR_FLOOR = 84
const CARD_EXIT_MS = 160

/** The station card: every fact the API has, with its composer pinned below. */
export const StationPopup = clientEntry(
  import.meta.url,
  function StationPopup(handle: Handle) {
    let host: HTMLElement | undefined
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let last: SelectedStation | null = null

    function place(anchor: Anchor | null): void {
      if (!host || anchor === null || !host.parentElement) return

      let bounds = host.parentElement.getBoundingClientRect()
      let width = host.offsetWidth
      let roomAbove = anchor.y - CARD_GAP - NAVBAR_FLOOR
      let roomBelow = bounds.height - anchor.y - CARD_GAP - CARD_PAD
      // Sit above the dot like a tooltip; only drop below when the dot is so
      // close to the top that there is no usable card height.
      let above = roomAbove >= 200
      let room = above ? roomAbove : roomBelow

      host.style.maxHeight = `${Math.max(180, room)}px`
      host.style.left = `${Math.min(
        Math.max(CARD_PAD, anchor.x - CARD_GAP - width),
        bounds.width - width - CARD_PAD,
      )}px`

      if (above) {
        host.style.top = 'auto'
        host.style.bottom = `${bounds.height - anchor.y + CARD_GAP}px`
      } else {
        host.style.bottom = 'auto'
        host.style.top = `${anchor.y + CARD_GAP}px`
      }
      host.dataset.side = above ? 'above' : 'below'
    }

    let unsubscribe = session.onAnchor(place)
    handle.signal.addEventListener('abort', unsubscribe, { once: true })

    session.addEventListener(
      'change',
      async () => {
        let next = session.selected

        if (next === null) {
          if (last === null || closing) return

          // Keep the last station on screen while the exit animation runs.
          closing = true
          await handle.update()
          closingTimer = setTimeout(() => {
            closing = false
            last = null
            handle.update()
          }, CARD_EXIT_MS)
          return
        }

        clearTimeout(closingTimer)
        closing = false
        last = next
        await handle.update()
        place(session.anchor)
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape') return
          if (document.querySelector('[popover]:popover-open') !== null) return
          if (session.selected === null) return
          session.clear()
        },
        { signal: handle.signal },
      )
    })

    handle.queueTask(() => {
      last = session.selected
      place(session.anchor)
    })

    return () => {
      let station = session.selected ?? (closing ? last : null)
      let facts = station?.facts ?? null
      let taf = station?.taf ?? null

      return (
        <div
          mix={[hostStyle, ref((node) => (host = node))]}
          style={{
            display: station === null ? 'none' : 'flex',
            animation: closing
              ? 'rmx-card-out 160ms ease-in forwards'
              : 'rmx-card-in 180ms ease-out',
            pointerEvents: closing ? 'none' : undefined,
          }}
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
                      {station.source}
                      {facts === null
                        ? ''
                        : ` · observed ${timeLabel(facts.observed_at)}`}{' '}
                      · {ageLabel(station.ageSeconds)}
                      {station.stale ? (
                        <span mix={staleStyle}>stale</span>
                      ) : null}
                    </p>

                    {station.parseStatus !== null &&
                    station.parseStatus !== 'ok' ? (
                      <p mix={warningStyle}>
                        Our parser disagrees with AWC on this report
                        {station.upstreamCategory
                          ? ` (upstream category ${station.upstreamCategory})`
                          : ''}
                        . The difference is kept visible.
                      </p>
                    ) : null}

                    {facts === null ? (
                      <p mix={mutedStyle}>No observation on file.</p>
                    ) : (
                      <>
                        <dl mix={factsStyle}>
                          <Fact label="Wind" value={windLabel(facts)} />
                          <Fact
                            label="Visibility"
                            value={visibilityLabel(facts)}
                          />
                          <Fact label="Ceiling" value={ceilingLabel(facts)} />
                          <Fact
                            label="Temperature"
                            value={temperatureLabel(facts)}
                          />
                          <Fact
                            label="Altimeter"
                            value={
                              facts.altimeter_in_hg === null
                                ? 'not reported'
                                : `${facts.altimeter_in_hg} inHg`
                            }
                          />
                          <Fact
                            label="Weather"
                            value={
                              facts.weather.length === 0
                                ? 'none'
                                : facts.weather.join(' ')
                            }
                          />
                        </dl>
                        <code mix={rawStyle}>{facts.raw}</code>
                      </>
                    )}

                    <h3 mix={sectionStyle}>Forecast</h3>
                    {taf === null ? (
                      <p mix={mutedStyle}>No TAF on file.</p>
                    ) : (
                      <ul mix={listStyle}>
                        {taf.periods.map((period) => (
                          <li key={period.ref}>
                            <span mix={periodHeadStyle}>
                              {period.change} ·{' '}
                              {windowLabel(period.from, period.to)}
                            </span>
                            <span mix={periodDetailStyle}>
                              {periodWindLabel(period)} ·{' '}
                              {period.visibility_sm === null
                                ? '—'
                                : `${period.visibility_sm} SM`}{' '}
                              ·{' '}
                              {period.ceiling_ft === null
                                ? 'no ceiling'
                                : `${period.ceiling_ft.toLocaleString()} ft`}
                              {period.weather.length === 0
                                ? ''
                                : ` · ${period.weather.join(' ')}`}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <h3 mix={sectionStyle}>Last 48 hours</h3>
                    <Timeline points={timelinePoints(station.history)} />

                    <h3 mix={sectionStyle}>Advisories within 50 nm</h3>
                    {station.advisories.length === 0 ? (
                      <p mix={mutedStyle}>None active.</p>
                    ) : (
                      <ul mix={listStyle}>
                        {station.advisories.map((advisory) => (
                          <li key={advisory.ref}>
                            <span mix={periodHeadStyle}>
                              {advisory.hazard} · {advisory.kind.toUpperCase()}
                            </span>
                            <span mix={periodDetailStyle}>
                              {advisory.distance_nm === null
                                ? ''
                                : `${advisory.distance_nm.toFixed(0)} nm · `}
                              until {timeLabel(advisory.valid_to)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>

              <footer mix={footerStyle}>
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

                      let drawer = document.getElementById('ai-drawer')
                      drawer?.showPopover()
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
  width: 'min(420px, calc(100vw - 32px))',
  maxHeight: 'calc(100% - 104px)',
  flexDirection: 'column',
  borderRadius: '16px',
  background: 'var(--glass-strong)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(26px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(26px) saturate(1.25)',
  overflow: 'hidden',
  animation: 'rmx-card-in 180ms ease-out',
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '12px 16px',
  borderBlockEnd: '1px solid var(--glass-border)',
})

const icaoStyle = css({ fontWeight: 700 })

const nameStyle = css({
  display: 'block',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const closeStyle = css({
  width: '26px',
  height: '26px',
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'rgba(255, 255, 255, 0.04)',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '15px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': {
    color: 'var(--ink-0)',
    background: 'rgba(255, 255, 255, 0.08)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 16px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  '& > p': { margin: 0 },
})

const categoryStyle = css({ fontSize: '12px' })

const ageStyle = css({ fontSize: '11px', color: 'var(--ink-3)' })

const staleStyle = css({
  marginInlineStart: '6px',
  padding: '0 6px',
  border: '1px solid var(--accent)',
  borderRadius: '4px',
  color: 'var(--accent)',
})

const warningStyle = css({
  padding: '7px 9px',
  borderInlineStart: '2px solid var(--accent)',
  borderRadius: '6px',
  background: 'rgba(255, 255, 255, 0.04)',
  fontSize: '11px',
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px 12px',
  margin: 0,
})

const factStyle = css({
  margin: 0,
  '& dt': {
    fontSize: '11px',
    color: 'var(--ink-3)',
  },
  '& dd': { margin: 0, fontSize: '12px' },
})

const rawStyle = css({
  display: 'block',
  padding: '7px 9px',
  border: '1px solid var(--glass-border)',
  borderRadius: '8px',
  background: 'rgba(0, 0, 0, 0.25)',
  fontSize: '11px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

const sectionStyle = css({
  margin: '12px 0 0',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  '& li': {
    display: 'flex',
    flexDirection: 'column',
    gap: '1px',
    paddingBlockEnd: '6px',
    borderBlockEnd: '1px solid var(--glass-border)',
  },
  '& li:last-child': { borderBlockEnd: 0, paddingBlockEnd: 0 },
})

const periodHeadStyle = css({ fontSize: '11px' })

const periodDetailStyle = css({
  fontSize: '11px',
  color: 'var(--ink-2)',
})

const mutedStyle = css({ fontSize: '12px', color: 'var(--ink-3)' })

const footerStyle = css({
  borderBlockStart: '1px solid var(--glass-border)',
  padding: '12px 16px',
})

const composerStyle = css({
  display: 'flex',
  gap: '6px',
  '& input': {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '7px 10px',
    border: '1px solid var(--glass-border)',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.28)',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '12px',
  },
})

const askStyle = css({
  padding: '7px 14px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '999px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
})
