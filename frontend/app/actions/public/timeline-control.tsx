import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { TIMELINE_HOURS, session } from '#app/ui/public/session.ts'

const HOUR_MS = 60 * 60 * 1000
const TICK_STEP = 1
const LABEL_STEP = 12

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const CLOCK = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
})

/** Where an hour sits on the rail, 0 to 100. */
function position(hour: number): number {
  return ((hour + TIMELINE_HOURS) / (TIMELINE_HOURS * 2)) * 100
}

const TICKS: number[] = []
for (let hour = -TIMELINE_HOURS; hour <= TIMELINE_HOURS; hour += TICK_STEP) {
  TICKS.push(hour)
}

const LABELS: number[] = []
for (let hour = -TIMELINE_HOURS; hour <= TIMELINE_HOURS; hour += LABEL_STEP) {
  LABELS.push(hour)
}

/**
 * The playback rail: a tick per hour across 48 either way, the past in the
 * warm tone and the future in grey, the present marked down the middle. The
 * whole rail is a range input, so dragging, clicking and the arrow keys all
 * move it, and the arrows beside it step one hour at a time.
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

          <div mix={railStyle}>
            <span aria-hidden="true" mix={trackStyle} />

            {TICKS.map((tick) => (
              <span
                aria-hidden="true"
                data-major={tick % LABEL_STEP === 0 ? 'true' : 'false'}
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
                  {tick === 0 ? 'now' : CLOCK.format(base + tick * HOUR_MS)}
                </span>
              ))}
            </div>
          </div>

          <span aria-live="polite" mix={readStyle}>
            {hour === 0
              ? 'live'
              : `${WHEN.format(base + hour * HOUR_MS)} · ${
                  hour < 0 ? 'observed' : 'forecast'
                }`}
          </span>

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
  top: '16px',
  left: '50%',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  width: 'min(760px, calc(100vw - 32px))',
  padding: '10px 14px',
  border: '1px solid var(--glass-border)',
  borderRadius: '999px',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  transform: 'translateX(-50%)',
  boxShadow: 'var(--shadow)',
})

const stepStyle = css({
  width: '30px',
  height: '30px',
  flexShrink: 0,
  padding: 0,
  border: '1px solid var(--glass-border)',
  borderRadius: '50%',
  background: 'transparent',
  color: 'var(--ink-1)',
  font: 'inherit',
  fontSize: '17px',
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

const railStyle = css({
  position: 'relative',
  flex: '1 1 auto',
  height: '40px',
  minWidth: 0,
})

const trackStyle = css({
  position: 'absolute',
  top: '9px',
  left: 0,
  right: 0,
  height: '2px',
  borderRadius: '1px',
  background: `linear-gradient(90deg, ${PAST} 0 50%, ${FUTURE} 50% 100%)`,
  opacity: 0.85,
})

const tickStyle = css({
  position: 'absolute',
  top: '6px',
  width: '1px',
  height: '8px',
  background: 'currentcolor',
  opacity: 0.65,
  transform: 'translateX(-50%)',
  transition: 'background 120ms ease, opacity 120ms ease',
  '&[data-major="true"]': { top: '3px', height: '14px', opacity: 0.9 },
  '&[data-side="past"]': { color: PAST },
  '&[data-side="future"]': { color: FUTURE },
  '&[data-selected="true"]': {
    top: '2px',
    height: '16px',
    width: '2px',
    background: 'var(--ink-0)',
    opacity: 1,
  },
})

const nowLineStyle = css({
  position: 'absolute',
  top: '1px',
  width: '2px',
  height: '18px',
  background: 'var(--ink-1)',
  opacity: 0.55,
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
  position: 'absolute',
  top: '24px',
  left: 0,
  right: 0,
  height: '14px',
})

const labelStyle = css({
  position: 'absolute',
  fontSize: '10px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
})

const readStyle = css({
  minWidth: '132px',
  fontSize: '10px',
  letterSpacing: '0.02em',
  color: 'var(--ink-2)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
})
