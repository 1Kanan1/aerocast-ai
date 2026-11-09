import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type {
  MapLayersResponse,
  StationList as StationListResponse,
} from '#app/lib/api-types.ts'
import type { ApiResult } from '#app/lib/api.ts'
import { EMPTY_LAYERS, islandLayers } from '#app/lib/map-data.ts'
import { routes } from '#app/routes.ts'
import { Document } from '#app/actions/document.tsx'
import { ChatSidebar } from '#app/actions/public/chat-sidebar.tsx'
import { MapIsland } from '#app/actions/public/map-island.tsx'
import { StationPopup } from '#app/actions/public/station-popup.tsx'
import { StationSearch } from '#app/actions/public/station-search.tsx'
import { AlertIcon, InfoIcon, SearchIcon, SparkIcon } from './public/icons.tsx'
import { glassStyle, tokensStyle, wordmarkStyle } from './layout.tsx'

interface MapShellProps {
  layers: ApiResult<MapLayersResponse>
  query: string
  stations: ApiResult<StationListResponse>
}

/** The map fills the window; every control floats over it. */
export function MapShell(handle: Handle<MapShellProps>) {
  return () => {
    let { layers, query, stations } = handle.props
    let island = layers.data ? islandLayers(layers.data.data) : EMPTY_LAYERS
    let rows = stations.data?.data ?? []

    return (
      <Document title="AeroCast AI">
        <main mix={[tokensStyle, shellStyle]}>
          <div mix={mapAreaStyle}>
            <MapIsland initial={island} />
            <StationPopup />
          </div>

          <header mix={[glassStyle, navbarStyle]}>
            <a href={routes.home.href()} mix={wordmarkStyle}>
              AEROCAST
            </a>
            <span mix={dividerStyle} />
            <button
              aria-label="Search stations"
              mix={iconStyle}
              popovertarget="station-search"
              title="Search"
              type="button"
            >
              <SearchIcon />
            </button>
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
            <button
              aria-label="Open explanation"
              mix={iconStyle}
              popovertarget="ai-drawer"
              title="Explanation"
              type="button"
            >
              <SparkIcon />
            </button>
          </header>

          <StationSearch initial={rows} query={query} />

          <div id="ai-drawer" mix={drawerStyle} popover="manual">
            <ChatSidebar />
          </div>

          <p mix={[glassStyle, disclaimerStyle]}>
            Educational tool. Not for flight planning. Briefing: 1-800-WX-BRIEF.
          </p>
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
})

const drawerStyle = css({
  position: 'fixed',
  inset: '0 0 0 auto',
  width: 'min(420px, 100vw)',
  height: '100dvh',
  margin: 0,
  padding: 0,
  border: 0,
  borderInlineStart: '1px solid rgba(255, 255, 255, 0.14)',
  background: 'rgba(18, 18, 22, 0.42)',
  color: 'var(--ink-0)',
  boxShadow: '-30px 0 90px rgba(0, 0, 0, 0.65)',
  backdropFilter: 'blur(34px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(34px) saturate(1.3)',
  transform: 'translateX(100%)',
  '&:popover-open': {
    transform: 'translateX(0)',
    animation: 'rmx-drawer-in 240ms cubic-bezier(0.22, 1, 0.36, 1)',
  },
  '&[data-closing="true"]': {
    animation: 'rmx-drawer-out 200ms cubic-bezier(0.4, 0, 1, 1) forwards',
  },
  '&::backdrop': { background: 'rgba(0, 0, 0, 0.45)' },
})

const disclaimerStyle = css({
  position: 'absolute',
  bottom: '44px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 2,
  margin: 0,
  padding: '6px 14px',
  borderRadius: '999px',
  maxWidth: 'min(560px, calc(100vw - 24px))',
  fontSize: '11px',
  lineHeight: 1.4,
  textAlign: 'center',
  color: 'var(--ink-3)',
})
