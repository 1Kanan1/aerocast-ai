import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import type {
  BundleMetar,
  BundlePeriod,
  BundleTaf,
} from '#app/lib/api-types.ts'
import { ageLabel, timeLabel } from '#app/lib/format.ts'
import { ChevronIcon } from '#app/ui/public/icons.tsx'
import {
  ceilingLabel,
  cloudsLabel,
  periodWindLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from '#app/lib/public/labels.ts'
import type { HistoryPoint, SelectedStation } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'
import {
  type Suggestion,
  AssistantTurn,
  ClarificationView,
  ThreadWelcome,
  UserTurn,
} from '#app/ui/public/thread-parts.tsx'

/** The timeline's clock, and the hour it is measured in. */
const HOUR_MS = 60 * 60 * 1000
const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const SUGGESTIONS: readonly Suggestion[] = [
  { prompt: 'What is the ceiling?' },
  { prompt: 'What is the visibility?' },
  { prompt: 'What is the wind doing?' },
  { prompt: 'What does the forecast say?' },
  { prompt: 'What does MVFR mean?' },
]

/** The answer surface: conditions first, then the thread, over the map. */
export const AnswerPanel = clientEntry(
  import.meta.url,
  function AnswerPanel(handle: Handle) {
    let scroller: HTMLElement | undefined
    let collapsed = false

    function scrollToEnd(): void {
      // A station with no turns is showing the welcome: leave it at the top
      // rather than parking the reader at the bottom of it.
      let station = session.selected
      if (station === null || station.thread.length === 0) return
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    }

    function restartFrom(index: number, question: string): void {
      let text = question.trim()
      if (text === '') return
      session.discardFrom(index)
      void session.ask(text)
    }

    session.addEventListener(
      'change',
      async () => {
        await handle.update()
        scrollToEnd()
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape') return
          if (document.querySelector('[popover]:popover-open') !== null) return
          if (session.selected === null && session.clarification === null) {
            return
          }
          session.clear()
        },
        { signal: handle.signal },
      )
    })

    return () => {
      let station = session.selected
      let clarification = session.clarification
      let open = station !== null || clarification !== null

      return (
        <aside
          aria-label="Answer"
          data-open={open ? 'true' : 'false'}
          mix={panelStyle}
        >
          <header mix={headerStyle}>
            <div mix={identityStyle}>
              <span mix={icaoStyle}>{station?.icao ?? 'AeroCast'}</span>
              <span mix={nameStyle}>
                {station?.name ?? 'Which station did you mean?'}
              </span>
            </div>
            <button
              aria-label="Close answers"
              mix={[closeStyle, on('click', () => session.clear())]}
              type="button"
            >
              ×
            </button>
          </header>

          {station === null ? null : (
            <>
              <div
                data-collapsed={collapsed ? 'true' : 'false'}
                mix={infoStyle}
              >
                {station.loading ? (
                  <p mix={mutedStyle}>Loading station facts…</p>
                ) : station.error !== null ? (
                  <p mix={mutedStyle}>{station.error}</p>
                ) : station.facts === null ? (
                  <p mix={mutedStyle}>No observation on file.</p>
                ) : session.viewHour === 0 ? (
                  <Conditions
                    compact={collapsed}
                    facts={station.facts}
                    station={station}
                  />
                ) : (
                  <TimedConditions
                    compact={collapsed}
                    hour={session.viewHour}
                    station={station}
                  />
                )}
              </div>

              <div mix={dividerStyle}>
                <button
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? 'Show conditions' : 'Hide conditions'}
                  mix={[
                    collapseStyle,
                    on('click', () => {
                      collapsed = !collapsed
                      handle.update()
                    }),
                  ]}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    mix={chevronStyle}
                    style={{
                      transform: `rotate(${collapsed ? 180 : 0}deg)`,
                    }}
                  >
                    <ChevronIcon />
                  </span>
                </button>
              </div>
            </>
          )}

          <div mix={[threadStyle, ref((node) => (scroller = node))]}>
            {clarification === null ? null : (
              <ClarificationView
                message={clarification.message}
                onChoose={(icao) => session.choose(icao)}
                options={clarification.options}
              />
            )}

            {station === null ||
            station.loading ||
            station.error !== null ? null : station.thread.length === 0 ? (
              <ThreadWelcome
                category={station.category}
                disabled={false}
                icao={station.icao}
                name={station.name}
                onAsk={(prompt) => void session.ask(prompt)}
                suggestions={SUGGESTIONS}
              />
            ) : (
              station.thread.map((entry, index) => (
                <div key={`${entry.question}-${index}`} mix={exchangeStyle}>
                  <UserTurn
                    onEdit={(next) => restartFrom(index, next)}
                    question={entry.question}
                  />
                  <AssistantTurn
                    entry={entry}
                    onRegenerate={() => {
                      let question = station.thread[index]?.question
                      if (question !== undefined) {
                        restartFrom(index, question)
                      }
                    }}
                    showName={index === 0}
                  />
                </div>
              ))
            )}
          </div>
        </aside>
      )
    }
  },
)

/** The facts every answer rests on, shown once above the prose. */
function Conditions(
  handle: Handle<{
    compact: boolean
    facts: BundleMetar
    station: SelectedStation
  }>,
) {
  return () => {
    let { compact, facts, station } = handle.props
    if (compact) return null

    return (
      <section aria-label="Conditions" mix={conditionsStyle}>
        <p mix={conditionsHeadStyle}>
          <span mix={categoryStyle}>{station.category ?? 'no category'}</span>
          <span mix={ageStyle}>
            {compact ? null : (
              <>
                {station.source} · observed {timeLabel(facts.observed_at)}{' '}
                ·{' '}
              </>
            )}
            {ageLabel(station.ageSeconds)}
            {station.stale ? ' · stale' : ''}
          </span>
        </p>

        {compact ? null : (
          <>
            {station.parseStatus !== null &&
            station.parseStatus !== 'ok' &&
            station.upstreamCategory !== null ? (
              <p mix={warningStyle}>
                Our parser disagrees with AWC on this report (upstream category{' '}
                {station.upstreamCategory}). The difference is kept visible.
              </p>
            ) : null}
            <dl mix={factsStyle}>
              <Fact label="Wind" value={windLabel(facts)} />
              <Fact label="Visibility" value={visibilityLabel(facts)} />
              <Fact label="Ceiling" value={ceilingLabel(facts)} />
              <Fact label="Clouds" value={cloudsLabel(facts)} />
              <Fact label="Temperature" value={temperatureLabel(facts)} />
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
                  facts.weather.length === 0 ? 'none' : facts.weather.join(' ')
                }
              />
            </dl>
            <code mix={rawStyle}>{facts.raw}</code>
          </>
        )}
      </section>
    )
  }
}

/**
 * The conditions at an hour the timeline points at: the report from that
 * hour when it is behind us, the forecast period when it is ahead. Hours
 * the data does not cover say so rather than borrowing the nearest number.
 */
function TimedConditions(
  handle: Handle<{ compact: boolean; hour: number; station: SelectedStation }>,
) {
  return () => {
    let { compact, hour, station } = handle.props
    if (compact) return null
    let target = session.timelineBase + hour * HOUR_MS

    if (hour < 0) {
      let point = nearestReport(station.history, target)
      if (point === null) {
        return (
          <p mix={mutedStyle}>No observation within an hour of that time.</p>
        )
      }

      return (
        <section aria-label="Conditions" mix={conditionsStyle}>
          <p mix={conditionsHeadStyle}>
            <span mix={categoryStyle}>{point.category ?? 'no category'}</span>
            <span mix={ageStyle}>
              observed {WHEN.format(Date.parse(point.obs_time))}
            </span>
          </p>
          {compact ? null : <code mix={rawStyle}>{point.raw}</code>}
        </section>
      )
    }

    let period = periodAt(station.taf, target)
    if (period === null) {
      return <p mix={mutedStyle}>The forecast does not reach that hour.</p>
    }

    return (
      <section aria-label="Conditions" mix={conditionsStyle}>
        <p mix={conditionsHeadStyle}>
          <span mix={categoryStyle}>{period.change}</span>
          <span mix={ageStyle}>
            forecast {WHEN.format(Date.parse(period.from))} to{' '}
            {WHEN.format(Date.parse(period.to))}
            {period.probability === null ? '' : ` · ${period.probability}%`}
          </span>
        </p>
        {compact ? null : (
          <dl mix={factsStyle}>
            <Fact label="Wind" value={periodWindLabel(period)} />
            <Fact label="Visibility" value={smLabel(period.visibility_sm)} />
            <Fact label="Ceiling" value={feetLabel(period.ceiling_ft)} />
            <Fact label="Clouds" value={cloudsOrUnknown(period.clouds)} />
            <Fact
              label="Weather"
              value={
                period.weather.length === 0
                  ? 'unknown'
                  : period.weather.join(' ')
              }
            />
            <Fact label="Temperature" value="unknown" />
          </dl>
        )}
      </section>
    )
  }
}

/** The report closest to an hour, if one is close enough to stand for it. */
function nearestReport(
  history: HistoryPoint[],
  target: number,
): HistoryPoint | null {
  let best: HistoryPoint | null = null
  let bestGap = Infinity

  for (let point of history) {
    let gap = Math.abs(Date.parse(point.obs_time) - target)
    if (gap < bestGap) {
      best = point
      bestGap = gap
    }
  }

  return bestGap <= HOUR_MS * 1.5 ? best : null
}

/** The forecast period covering an hour, latest start first. */
function periodAt(taf: BundleTaf | null, target: number): BundlePeriod | null {
  if (taf === null) return null

  let covering = taf.periods.filter(
    (period) =>
      Date.parse(period.from) <= target && target <= Date.parse(period.to),
  )
  return covering.at(-1) ?? null
}

function smLabel(miles: number | null): string {
  return miles === null ? 'unknown' : `${miles} SM`
}

function feetLabel(feet: number | null): string {
  return feet === null ? 'unknown' : `${feet.toLocaleString()} ft`
}

function cloudsOrUnknown(clouds: BundlePeriod['clouds']): string {
  if (clouds.length === 0) return 'unknown'
  return clouds
    .map((cloud) =>
      cloud.base_ft === null
        ? cloud.cover
        : `${cloud.cover} ${cloud.base_ft.toLocaleString()} ft`,
    )
    .join(', ')
}

function Fact(handle: Handle<{ label: string; value: string }>) {
  return () => (
    <div mix={factStyle}>
      <dt>{handle.props.label}</dt>
      <dd>{handle.props.value}</dd>
    </div>
  )
}

const panelStyle = css({
  position: 'absolute',
  top: '104px',
  right: '16px',
  bottom: '44px',
  zIndex: 4,
  display: 'none',
  flexDirection: 'column',
  width: 'min(520px, calc(100vw - 32px))',
  borderRadius: '20px',
  border: '1px solid var(--line)',
  background: 'var(--paper-2)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
  '&[data-open="true"]': {
    display: 'flex',
    animation: 'rmx-card-in 200ms ease-out',
  },
  '@media (max-width: 900px)': { bottom: '120px' },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '14px 20px',
  borderBlockEnd: '1px solid var(--line)',
})

const identityStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
})

const icaoStyle = css({ fontWeight: 700 })

const nameStyle = css({
  fontSize: '11px',
  color: 'var(--ink-3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const closeStyle = css({
  width: '28px',
  height: '28px',
  flexShrink: 0,
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-0)', background: 'rgba(255, 255, 255, 0.06)' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

/**
 * The conditions stay put while the thread scrolls under them. The chevron
 * sits on the divider between the two, and folds the block to its headline.
 * Nothing here scrolls: it clips, so a long block cannot take the panel.
 */
const infoStyle = css({
  position: 'relative',
  flexShrink: 0,
  maxHeight: '360px',
  overflow: 'hidden',
  padding: '14px 20px 0',
  transition: 'max-height 220ms ease, padding 220ms ease',
  '&[data-collapsed="true"]': {
    maxHeight: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
  },
})

/** A zero-height seam between the conditions and the thread, for the chevron. */
const dividerStyle = css({
  position: 'relative',
  height: 0,
  flexShrink: 0,
  zIndex: 1,
})

/** The whole seam is the button; the chevron is the handle on it. */
const collapseStyle = css({
  position: 'absolute',
  left: 0,
  right: 0,
  top: '-13px',
  height: '26px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '-2px',
  },
})

const chevronStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '26px',
  height: '26px',
  border: '1px solid var(--line)',
  borderRadius: '50%',
  background: 'var(--paper-2)',
  transition: 'transform 200ms ease, color 120ms ease',
  '&:hover': { color: 'var(--ink-0)' },
})

const threadStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '20px',
  scrollBehavior: 'smooth',
})

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingBlockStart: '26px',
})

const conditionsStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingBlockEnd: '16px',
  borderBlockEnd: '1px solid var(--line)',
})

const conditionsHeadStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  margin: 0,
})

const categoryStyle = css({ fontSize: '12px', color: 'var(--ink-1)' })

const ageStyle = css({ fontSize: '11px', color: 'var(--ink-3)' })

const warningStyle = css({
  margin: 0,
  padding: '7px 9px',
  borderInlineStart: '2px solid var(--accent)',
  borderRadius: '6px',
  background: 'rgba(255, 255, 255, 0.04)',
  fontSize: '11px',
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '10px 16px',
  margin: 0,
})

const factStyle = css({
  margin: 0,
  '& dt': { fontSize: '11px', color: 'var(--ink-3)' },
  '& dd': { margin: 0, fontSize: '12px', color: 'var(--ink-0)' },
})

const rawStyle = css({
  display: 'block',
  padding: '7px 9px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'rgba(0, 0, 0, 0.28)',
  fontSize: '11px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

const mutedStyle = css({ margin: 0, fontSize: '12px', color: 'var(--ink-3)' })
