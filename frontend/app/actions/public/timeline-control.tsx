import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { TIMELINE_HOURS, session } from '#app/ui/public/session.ts'

const HOUR_MS = 60 * 60 * 1000

const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * The timeline replaces the navbar while a station is selected: the clock
 * reaches 48 hours either way, one hour at a time, and the panel reads the
 * observation or the forecast period that covers the chosen hour.
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
      let target = new Date(Date.now() + hour * HOUR_MS)
      let mood = hour === 0 ? 'live' : hour < 0 ? 'observed' : 'forecast'

      return (
        <div aria-label="Timeline" mix={barStyle}>
          <span mix={timeStyle}>
            {hour === 0 ? 'Now' : WHEN.format(target)}
          </span>
          <span mix={moodStyle}>{mood}</span>
          <input
            aria-label="Hours from now"
            max={TIMELINE_HOURS}
            min={-TIMELINE_HOURS}
            mix={[
              sliderStyle,
              on('input', (event) =>
                session.setViewHour(event.currentTarget.valueAsNumber),
              ),
            ]}
            step={1}
            type="range"
            value={hour}
          />
          <button
            aria-label="Back to now"
            disabled={hour === 0}
            mix={[nowStyle, on('click', () => session.setViewHour(0))]}
            type="button"
          >
            now
          </button>
        </div>
      )
    }
  },
)

const barStyle = css({
  position: 'absolute',
  top: '16px',
  left: '50%',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '8px 14px',
  border: 'var(--glass-border)',
  borderRadius: '999px',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  transform: 'translateX(-50%)',
  boxShadow: 'var(--shadow)',
  width: 'min(560px, calc(100vw - 32px))',
})

const timeStyle = css({
  minWidth: '88px',
  fontSize: '12px',
  color: 'var(--ink-0)',
  fontVariantNumeric: 'tabular-nums',
})

const moodStyle = css({
  minWidth: '58px',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const sliderStyle = css({
  flex: '1 1 auto',
  minWidth: 0,
  accentColor: 'var(--ink-0)',
  cursor: 'pointer',
})

const nowStyle = css({
  padding: '4px 10px',
  border: '1px solid var(--glass-border)',
  borderRadius: '999px',
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  '&:disabled': { opacity: 0.4, cursor: 'default' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})
