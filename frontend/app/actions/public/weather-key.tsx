import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { weatherLayers } from '#app/ui/public/weather-layers.ts'

const RAIN_SCALE =
  'linear-gradient(90deg, #d6ecf7, #90c7e3, #60b0aa, #96c07a, #e8d778, #e8a35a, #d9674f)'
const TEMP_SCALE =
  'linear-gradient(90deg, #5f8fb8, #6f9f9a, #a8b071, #d09a4e, #c4643f)'

/** The colour key, with a switch per layer beside its ramp. */
export const WeatherKey = clientEntry(
  import.meta.url,
  function WeatherKey(handle: Handle) {
    weatherLayers.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    return () => (
      <div aria-label="Weather layers" mix={keyStyle}>
        <label mix={rowStyle}>
          <input
            aria-label="Rain layer"
            checked={weatherLayers.rain}
            mix={[
              switchStyle,
              on('change', () => weatherLayers.toggle('rain')),
            ]}
            role="switch"
            type="checkbox"
          />
          <span mix={labelStyle}>Rain</span>
          <span
            aria-hidden="true"
            mix={barStyle}
            style={{ background: RAIN_SCALE }}
          />
          <span mix={hintStyle}>light → heavy</span>
        </label>

        <label mix={rowStyle}>
          <input
            aria-label="Temperature layer"
            checked={weatherLayers.temp}
            mix={[
              switchStyle,
              on('change', () => weatherLayers.toggle('temp')),
            ]}
            role="switch"
            type="checkbox"
          />
          <span mix={labelStyle}>Temp</span>
          <span
            aria-hidden="true"
            mix={barStyle}
            style={{ background: TEMP_SCALE }}
          />
          <span mix={hintStyle}>cold → warm</span>
        </label>

        <label mix={rowStyle}>
          <input
            aria-label="Wind layer"
            checked={weatherLayers.wind}
            mix={[
              switchStyle,
              on('change', () => weatherLayers.toggle('wind')),
            ]}
            role="switch"
            type="checkbox"
          />
          <span mix={labelStyle}>Wind</span>
          <span mix={hintStyle}>flow</span>
        </label>
      </div>
    )
  },
)

const keyStyle = css({
  position: 'absolute',
  left: '16px',
  bottom: '132px',
  zIndex: 2,
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  padding: '8px 10px',
  border: '1px solid var(--glass-border)',
  borderRadius: '10px',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  boxShadow: 'var(--shadow)',
  fontSize: '10px',
  lineHeight: 1.3,
  color: 'var(--ink-3)',
  '@media (max-width: 900px)': { display: 'none' },
})

const rowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  cursor: 'pointer',
})

const labelStyle = css({
  width: '26px',
  color: 'var(--ink-2)',
})

const barStyle = css({
  width: '80px',
  height: '6px',
  border: '1px solid var(--glass-border)',
  borderRadius: '3px',
})

const hintStyle = css({ color: 'var(--ink-3)' })

const switchStyle = css({
  appearance: 'none',
  position: 'relative',
  width: '24px',
  height: '13px',
  flexShrink: 0,
  margin: 0,
  borderRadius: '999px',
  background: 'rgba(255, 255, 255, 0.18)',
  cursor: 'pointer',
  transition: 'background 120ms ease',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '9px',
    height: '9px',
    borderRadius: '50%',
    background: 'var(--ink-2)',
    transition: 'transform 120ms ease, background 120ms ease',
  },
  '&:checked': { background: 'var(--ink-0)' },
  '&:checked::before': {
    transform: 'translateX(11px)',
    background: 'var(--paper)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})
