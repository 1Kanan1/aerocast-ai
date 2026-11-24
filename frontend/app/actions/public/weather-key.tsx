import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { LayersIcon } from '#app/ui/public/icons.tsx'
import { weatherLayers } from '#app/ui/public/weather-layers.ts'

const RAIN_SCALE =
  'linear-gradient(90deg,' +
  ' rgba(56, 189, 248, 0.28) 0 25%,' +
  ' rgba(56, 189, 248, 0.52) 25% 50%,' +
  ' rgba(14, 165, 233, 0.75) 50% 75%,' +
  ' rgba(2, 132, 199, 0.92) 75% 100%)'
const TEMP_SCALE =
  'linear-gradient(90deg, #5f8fb8, #6f9f9a, #a8b071, #d09a4e, #c4643f)'
const HAZARD_SWATCH =
  'repeating-linear-gradient(45deg, rgba(224, 96, 63, 0.9) 0 1px, transparent 1px 5px)'

/**
 * The colour key, with a switch per layer beside its ramp. Always visible
 * bottom-left on desktop; collapses behind a floating Layers toggle on <=900px.
 */
export const WeatherKey = clientEntry(
  import.meta.url,
  function WeatherKey(handle: Handle) {
    let mobileOpen = false

    weatherLayers.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape' || !mobileOpen) return
          mobileOpen = false
          handle.update()
        },
        { signal: handle.signal },
      )
    })

    return () => (
      <div mix={wrapStyle}>
        <button
          aria-expanded={mobileOpen ? 'true' : 'false'}
          aria-label="Toggle map layers"
          data-open={mobileOpen ? 'true' : 'false'}
          mix={[
            mobileTriggerStyle,
            on('click', () => {
              mobileOpen = !mobileOpen
              handle.update()
            }),
          ]}
          type="button"
        >
          <LayersIcon />
          <span>Layers</span>
        </button>

        <div
          aria-label="Weather layers"
          data-mobile-open={mobileOpen ? 'true' : 'false'}
          mix={keyStyle}
        >
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

          <label mix={rowStyle}>
            <input
              aria-label="Advisories layer"
              checked={weatherLayers.advisories}
              mix={[
                switchStyle,
                on('change', () => weatherLayers.toggle('advisories')),
              ]}
              role="switch"
              type="checkbox"
            />
            <span mix={labelStyle}>Hazards</span>
            <span
              aria-hidden="true"
              mix={barStyle}
              style={{
                background: HAZARD_SWATCH,
                backgroundColor: 'rgba(224, 96, 63, 0.14)',
              }}
            />
            <span mix={hintStyle}>airmet · sigmet</span>
          </label>
        </div>
      </div>
    )
  },
)

const wrapStyle = css({
  position: 'absolute',
  left: '16px',
  bottom: '132px',
  zIndex: 5,
  '@media (max-width: 900px)': {
    left: 'auto',
    bottom: 'auto',
    top: '16px',
    right: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: '8px',
  },
})

const mobileTriggerStyle = css({
  display: 'none',
  '@media (max-width: 900px)': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    height: '40px',
    padding: '0 12px',
    border: '1px solid var(--glass-border)',
    borderRadius: '999px',
    background: 'var(--glass-strong)',
    color: 'var(--ink-1)',
    boxShadow: 'var(--shadow)',
    backdropFilter: 'blur(20px) saturate(1.2)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
    font: 'inherit',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    transition:
      'background 160ms var(--ease-out), border-color 160ms var(--ease-out), color 160ms var(--ease-out), transform 140ms var(--ease-out)',
    '&:active': { transform: 'scale(0.95)' },
    '&[data-open="true"]': {
      borderColor: 'var(--accent)',
      color: 'var(--accent)',
    },
  },
})

const keyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  padding: '9px 11px',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  background: 'var(--glass)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  boxShadow: 'var(--shadow)',
  fontSize: '11px',
  lineHeight: 1.3,
  color: 'var(--ink-2)',
  transition:
    'background-color 220ms var(--ease-out), border-color 220ms var(--ease-out), opacity 220ms var(--ease-out), transform 220ms var(--ease-out)',
  '@media (max-width: 900px)': {
    background: 'var(--glass-strong)',
    padding: '10px 12px',
    gap: '8px',
    transformOrigin: 'top right',
    opacity: 0,
    transform: 'translateY(-6px) scale(0.96)',
    pointerEvents: 'none',
    visibility: 'hidden',
    '&[data-mobile-open="true"]': {
      opacity: 1,
      transform: 'translateY(0) scale(1)',
      pointerEvents: 'auto',
      visibility: 'visible',
    },
  },
})

const rowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  minHeight: '22px',
  cursor: 'pointer',
  '@media (max-width: 900px)': { minHeight: '30px' },
})

const labelStyle = css({
  width: '50px',
  fontWeight: 500,
  color: 'var(--ink-1)',
})

const barStyle = css({
  width: '72px',
  height: '6px',
  border: '1px solid var(--line)',
  borderRadius: '3px',
})

const hintStyle = css({ color: 'var(--ink-3)', fontSize: '10px' })

const switchStyle = css({
  appearance: 'none',
  position: 'relative',
  width: '26px',
  height: '15px',
  flexShrink: 0,
  margin: 0,
  borderRadius: '999px',
  background: 'var(--line-strong)',
  cursor: 'pointer',
  transition: 'background 180ms var(--ease-out)',
  '&::before': {
    content: '""',
    position: 'absolute',
    top: '2px',
    left: '2px',
    width: '11px',
    height: '11px',
    borderRadius: '50%',
    background: 'var(--paper-2)',
    transition:
      'transform 220ms var(--ease-spring), background 180ms var(--ease-out)',
  },
  '&:checked': { background: 'var(--accent)' },
  '&:checked::before': {
    transform: 'translateX(11px)',
    background: 'var(--accent-ink)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '2px',
  },
})
