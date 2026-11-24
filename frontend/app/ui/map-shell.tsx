import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { MapLayersResponse } from '#app/lib/api-types.ts'
import type { ApiResult } from '#app/lib/api.ts'
import { EMPTY_LAYERS, islandLayers } from '#app/lib/map-data.ts'
import { routes } from '#app/routes.ts'
import { Document } from '#app/actions/document.tsx'
import { AnswerPanel } from '#app/actions/public/answer-panel.tsx'
import { AskBar } from '#app/actions/public/ask-bar.tsx'
import { MapIsland } from '#app/actions/public/map-island.tsx'
import { SketchLayer } from '#app/actions/public/sketch-layer.tsx'
import { AreaPanel } from '#app/actions/public/area-panel.tsx'
import { StationPopup } from '#app/actions/public/station-popup.tsx'
import { ThemeToggle } from '#app/actions/public/theme-toggle.tsx'
import { TimelineControl } from '#app/actions/public/timeline-control.tsx'
import { WeatherKey } from '#app/actions/public/weather-key.tsx'
import { AlertIcon, InfoIcon } from './public/icons.tsx'
import { glassStyle, tokensStyle, wordmarkStyle } from './layout.tsx'

interface MapShellProps {
  layers: ApiResult<MapLayersResponse>
}

/** The map fills the window; every control floats over it. */
export function MapShell(handle: Handle<MapShellProps>) {
  return () => {
    let { layers } = handle.props
    let island = layers.data ? islandLayers(layers.data.data) : EMPTY_LAYERS

    return (
      <Document title="AeroCast AI">
        <main mix={[tokensStyle, shellStyle]}>
          <div mix={mapAreaStyle}>
            <MapIsland initial={island} />
            <SketchLayer />
            <StationPopup />
            <AreaPanel />
            <TimelineControl />
            <AnswerPanel />
          </div>

          <AskBar />

          <a href={routes.home.href()} mix={[wordmarkStyle, brandStyle]}>
            AEROCAST
          </a>

          <nav aria-label="Map tools" mix={toolsStyle}>
            <a
              aria-label="Advisories"
              href={routes.advisories.href()}
              mix={[glassStyle, toolButtonStyle]}
              title="Advisories"
            >
              <AlertIcon />
            </a>
            <a
              aria-label="About"
              href={routes.about.href()}
              mix={[glassStyle, toolButtonStyle]}
              title="About"
            >
              <InfoIcon />
            </a>
            <ThemeToggle surface="glass" />
          </nav>

          <WeatherKey />
        </main>
      </Document>
    )
  }
}

const shellStyle = css({
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  position: 'relative',
  height: '100dvh',
  overflow: 'hidden',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  fontFamily: 'var(--font-sans)',
  fontSize: '14px',
  lineHeight: 1.55,
  WebkitFontSmoothing: 'antialiased',
})

const mapAreaStyle = css({
  position: 'absolute',
  inset: 0,
})

const brandStyle = css({
  position: 'absolute',
  top: '16px',
  left: '16px',
  zIndex: 4,
  display: 'inline-flex',
  alignItems: 'center',
  height: '40px',
  paddingInline: '4px',
  transition: 'opacity 180ms var(--ease-out)',
  '@media (max-width: 900px)': {
    top: '14px',
    left: '12px',
    height: '36px',
    ':is(main:has([aria-label="Timeline"])) &': {
      opacity: 0,
      pointerEvents: 'none',
    },
  },
})

const toolsStyle = css({
  position: 'absolute',
  top: '16px',
  right: '16px',
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  transition: 'top 240ms var(--ease-out)',
  '@media (max-width: 900px)': {
    top: '14px',
    right: '12px',
    gap: '6px',
    ':is(main:has([aria-label="Timeline"])) &': {
      top: '88px',
      left: '12px',
      right: 'auto',
    },
  },
})

const toolButtonStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '40px',
  height: '40px',
  borderRadius: '999px',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  textDecoration: 'none',
  transition:
    'background 160ms var(--ease-out), border-color 160ms var(--ease-out), color 160ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': {
    background: 'var(--glass-strong)',
    borderColor: 'var(--line-strong)',
    color: 'var(--ink-0)',
  },
  '&:active': {
    transform: 'scale(0.92)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--focus-ring)',
    outlineOffset: '2px',
  },
  '@media (max-width: 900px)': {
    width: '36px',
    height: '36px',
  },
})
