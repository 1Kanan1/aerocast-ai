import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { TIMELINE_HOURS, session } from '#app/ui/public/session.ts'

const HOUR_MS = 60 * 60 * 1000
const LABEL_STEP = 24
const MAJOR_STEP = 6

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/** Where an hour sits on the rail, 0 to 100. */
function position(hour: number): number {
  return ((hour + TIMELINE_HOURS) / (TIMELINE_HOURS * 2)) * 100
}

const TICKS: number[] = []
for (let hour = -TIMELINE_HOURS; hour <= TIMELINE_HOURS; hour += 1) {
  TICKS.push(hour)
}

const LABELS: number[] = []
for (let hour = -TIMELINE_HOURS; hour <= TIMELINE_HOURS; hour += LABEL_STEP) {
  LABELS.push(hour)
}

/**
 * The playback rail: a tick per hour across 48 either way, the past in the
 * warm tone and the future in grey, the present marked down the middle. The
 * chosen date and time sit above it and the hour markers below. The whole
 * rail is a range input, so dragging, clicking and the arrow keys all move
 * it, and the arrows beside it step one hour at a time.
 */
export const TimelineControl = clientEntry(
  import.meta.url,
  function TimelineControl(handle: Handle) {
    let keepNavbar = (): void => {
      let navbar = document.querySelector<HTMLElement>('[data-navbar]')
      if (navbar !== null) {
        navbar.style.display = session.selected === null ? '' : 'none'
      }
      handle.update()
    }

    session.addEventListener('change', keepNavbar, { signal: handle.signal })

    handle.queueTask(() => {
      keepNavbar()
    })

    return () => {
      let station = session.selected
      if (station === null) return null

      let hour = session.viewHour
      let base = session.timelineBase
      let at = base + hour * HOUR_MS
      let mood = hour === 0 ? 'live' : hour < 0 ? 'observed' : 'forecast'

      return (
        <div aria-label="Timeline" mix={barStyle}>
          <button
            aria-label="One hour earlier"
            disabled={hour <= -TIMELINE_HOURS}
            mix={[stepStyle, on('click', () => session.setViewHour(hour - 1))]}
            type="button"
          >
            ‹
          </button>

          <div mix={bodyStyle}>
            <p aria-live="polite" mix={headStyle}>
              <span mix={whenStyle}>
                {hour === 0 ? 'Now' : WHEN.format(at)}
              </span>
              <span mix={moodStyle}>{mood}</span>
            </p>

            <div mix={railStyle}>
              <span aria-hidden="true" mix={trackStyle} />

              {TICKS.map((tick) => (
                <span
                  aria-hidden="true"
                  data-major={tick % MAJOR_STEP === 0 ? 'true' : 'false'}
                  data-side={tick < 0 ? 'past' : 'future'}
                  data-selected={tick === hour ? 'true' : 'false'}
                  key={tick}
                  mix={tickStyle}
                  style={{ left: `${position(tick)}%` }}
                />
              ))}

              <span
                aria-hidden="true"
                mix={nowLineStyle}
                style={{ left: '50%' }}
              />

              <input
                aria-label="Hours from now"
                aria-valuetext={
                  hour === 0
                    ? 'now'
                    : `${Math.abs(hour)} hours ${hour < 0 ? 'ago' : 'ahead'}`
                }
                max={TIMELINE_HOURS}
                min={-TIMELINE_HOURS}
                mix={[
                  rangeStyle,
                  on('input', (event) =>
                    session.setViewHour(event.currentTarget.valueAsNumber),
                  ),
                ]}
                step={1}
                type="range"
                value={hour}
              />
            </div>

            <div aria-hidden="true" mix={labelsStyle}>
              {LABELS.map((tick) => (
                <span
                  key={tick}
                  mix={labelStyle}
                  style={{
                    left: `${position(tick)}%`,
                    transform:
                      tick === -TIMELINE_HOURS
                        ? 'translateX(0)'
                        : tick === TIMELINE_HOURS
                          ? 'translateX(-100%)'
                          : 'translateX(-50%)',
                  }}
                >
                  {tick === 0 ? 'now' : WHEN.format(base + tick * HOUR_MS)}
                </span>
              ))}
            </div>
          </div>

          <button
            aria-label="One hour later"
            disabled={hour >= TIMELINE_HOURS}
            mix={[stepStyle, on('click', () => session.setViewHour(hour + 1))]}
            type="button"
          >
            ›
          </button>
        </div>
      )
    }
  },
)

const PAST = '#b0861f'
const FUTURE = '#787c7c'

const barStyle = css({
  position: 'absolute',
  top: '12px',
  left: '50%',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  width: 'min(700px, calc(100vw - 32px))',
  padding: '8px 12px',
  border: '1px solid var(--glass-border)',
  borderRadius: '20px',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  transform: 'translateX(-50%)',
  boxShadow: 'var(--shadow)',
  '@media (max-width: 900px)': { width: 'calc(100vw - 24px)' },
})

const stepStyle = css({
  width: '28px',
  height: '28px',
  flexShrink: 0,
  padding: 0,
  border: '1px solid var(--glass-border)',
  borderRadius: '50%',
  background: 'transparent',
  color: 'var(--ink-1)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
  transition: 'color 120ms ease, border-color 120ms ease',
  '&:hover': { color: 'var(--ink-0)', borderColor: 'var(--ink-3)' },
  '&:disabled': { opacity: 0.35, cursor: 'default' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

const bodyStyle = css({
  flex: '1 1 auto',
  minWidth: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
})

const headStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  gap: '8px',
  margin: 0,
  lineHeight: 1.1,
})

const whenStyle = css({
  fontSize: '11px',
  color: 'var(--ink-0)',
  fontVariantNumeric: 'tabular-nums',
})

const moodStyle = css({
  fontSize: '9px',
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const railStyle = css({
  position: 'relative',
  height: '18px',
})

const trackStyle = css({
  position: 'absolute',
  top: '8px',
  left: 0,
  right: 0,
  height: '2px',
  borderRadius: '1px',
  background: `linear-gradient(90deg, ${PAST} 0 50%, ${FUTURE} 50% 100%)`,
  opacity: 0.85,
})

const tickStyle = css({
  position: 'absolute',
  top: '5px',
  width: '1px',
  height: '7px',
  background: 'currentcolor',
  opacity: 0.6,
  transform: 'translateX(-50%)',
  transition: 'background 120ms ease, opacity 120ms ease',
  '&[data-major="true"]': { top: '2px', height: '13px', opacity: 0.9 },
  '&[data-side="past"]': { color: PAST },
  '&[data-side="future"]': { color: FUTURE },
  '&[data-selected="true"]': {
    top: '1px',
    height: '15px',
    width: '2px',
    background: 'var(--ink-0)',
    opacity: 1,
  },
})

const nowLineStyle = css({
  position: 'absolute',
  top: '1px',
  width: '2px',
  height: '16px',
  background: 'var(--ink-1)',
  opacity: 0.5,
  transform: 'translateX(-50%)',
})

const rangeStyle = css({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  margin: 0,
  opacity: 0,
  cursor: 'pointer',
  '&:focus-visible': { outline: 'none' },
})

const labelsStyle = css({
  position: 'relative',
  height: '12px',
})

const labelStyle = css({
  position: 'absolute',
  top: 0,
  fontSize: '9px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
})
