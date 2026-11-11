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

          <header data-navbar mix={[glassStyle, navbarStyle]}>
            <a href={routes.home.href()} mix={wordmarkStyle}>
              AEROCAST
            </a>
            <span mix={dividerStyle} />
            <a
              aria-label="Advisories"
              href={routes.advisories.href()}
              mix={iconStyle}
              title="Advisories"
            >
              <AlertIcon />
            </a>
            <a
              aria-label="About"
              href={routes.about.href()}
              mix={iconStyle}
              title="About"
            >
              <InfoIcon />
            </a>
          </header>

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
  fontFamily:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  fontSize: '14px',
  lineHeight: 1.6,
  WebkitFontSmoothing: 'antialiased',
})

const mapAreaStyle = css({
  position: 'absolute',
  inset: 0,
})

const navbarStyle = css({
  position: 'absolute',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 4,
  display: 'flex',
  alignItems: 'center',
  gap: '2px',
  padding: '6px 8px 6px 16px',
  borderRadius: '999px',
  maxWidth: 'calc(100vw - 24px)',
})

const dividerStyle = css({
  width: '1px',
  height: '18px',
  marginInline: '8px',
  background: 'var(--line)',
})

const iconStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '36px',
  height: '36px',
  borderRadius: '999px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  textDecoration: 'none',
  '&:hover': {
    background: 'rgba(255, 255, 255, 0.07)',
    color: 'var(--ink-0)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})
