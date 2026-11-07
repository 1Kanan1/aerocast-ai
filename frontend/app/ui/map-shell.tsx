import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type {
  MapLayersResponse,
  StationList as StationListResponse,
} from '../lib/api-types.ts'
import type { ApiResult } from '../lib/api.ts'
import { EMPTY_LAYERS, islandLayers } from '../lib/map-data.ts'
import { routes } from '../routes.ts'
import { Document } from '../actions/document.tsx'
import { ChatSidebar } from '../actions/public/chat-sidebar.tsx'
import { MapIsland } from '../actions/public/map-island.tsx'
import { StationPopup } from '../actions/public/station-popup.tsx'
import { navStyle, tokensStyle, wordmarkStyle } from './layout.tsx'

interface MapShellProps {
  layers: ApiResult<MapLayersResponse>
  query: string
  stations: ApiResult<StationListResponse>
}

/** The map page is its own shell: full bleed, with the chat rail always on screen. */
export function MapShell(handle: Handle<MapShellProps>) {
  return () => {
    let { layers, query, stations } = handle.props
    let island = layers.data ? islandLayers(layers.data.data) : EMPTY_LAYERS
    let rows = stations.data?.data ?? []
    let searching = query.trim() !== ''

    return (
      <Document title="AeroCast AI">
        <main mix={[tokensStyle, shellStyle]}>
          <header mix={navbarStyle}>
            <a href={routes.home.href()} mix={wordmarkStyle}>
              AEROCAST
            </a>
            <nav mix={navStyle}>
              <a aria-current="page" href={routes.home.href()}>
                Map
              </a>
              <a href={routes.advisories.href()}>Advisories</a>
              <a href={routes.about.href()}>About</a>
            </nav>
          </header>

          <div mix={mapAreaStyle}>
            <MapIsland initial={island} />

            <form action={routes.home.href()} method="get" mix={searchStyle}>
              <div mix={searchRowStyle}>
                <input
                  aria-label="Search stations"
                  defaultValue={query}
                  name="q"
                  placeholder="Search ICAO, name or state"
                  type="search"
                />
                <button type="submit">Search</button>
              </div>

              {searching ? (
                rows.length === 0 ? (
                  <p mix={emptyStyle}>No stations match this search.</p>
                ) : (
                  <ul mix={resultsStyle}>
                    {rows.map((station) => (
                      <li key={station.icao}>
                        <a href={routes.station.href({ icao: station.icao })}>
                          <span mix={resultIcaoStyle}>{station.icao}</span>
                          <span>{station.name}</span>
                          <span mix={resultStateStyle}>
                            {station.state ?? ''}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </form>

            <StationPopup />

            <p mix={mapNoteStyle}>Not for navigation.</p>
          </div>

          <div mix={railStyle}>
            <div mix={chatSlotStyle}>
              <ChatSidebar />
            </div>
            <footer mix={footerStyle}>
              <p>
                Educational tool. Not for flight planning. Obtain an official
                briefing from Flight Service (1-800-WX-BRIEF) before you fly.
              </p>
              <p>Weather data: aviationweather.gov, US Government public domain.</p>
            </footer>
          </div>
        </main>
      </Document>
    )
  }
}

const shellStyle = css({
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  height: '100dvh',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 360px',
  gridTemplateRows: 'auto minmax(0, 1fr)',
  overflow: 'hidden',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  fontSize: '14px',
  lineHeight: 1.6,
  WebkitFontSmoothing: 'antialiased',
  '@media (max-width: 900px)': {
    gridTemplateColumns: 'minmax(0, 1fr)',
    gridTemplateRows: 'auto minmax(0, 55dvh) minmax(0, 1fr)',
  },
})

const navbarStyle = css({
  gridColumn: '1 / -1',
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '12px 24px',
  padding: '10px 18px',
  borderBlockEnd: '1px solid var(--line)',
  background: 'var(--paper)',
})

const mapAreaStyle = css({
  position: 'relative',
  minHeight: 0,
  background: 'var(--paper-2)',
})

const searchStyle = css({
  position: 'absolute',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 2,
  width: 'min(420px, calc(100% - 32px))',
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
  boxShadow: '0 10px 24px rgba(10, 10, 10, 0.08)',
})

const searchRowStyle = css({
  display: 'flex',
  gap: '8px',
  '& input': {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '6px 9px',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    background: 'var(--paper)',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '13px',
  },
  '& button': {
    padding: '6px 12px',
    border: '1px solid var(--ink-0)',
    borderRadius: '6px',
    background: 'var(--ink-0)',
    color: 'var(--paper)',
    font: 'inherit',
    fontSize: '13px',
    cursor: 'pointer',
  },
})

const resultsStyle = css({
  listStyle: 'none',
  margin: '8px 0 0',
  padding: 0,
  maxHeight: '40vh',
  overflowY: 'auto',
  borderBlockStart: '1px solid var(--line)',
  '& li': { borderBlockEnd: '1px solid var(--line)' },
  '& a': {
    display: 'grid',
    gridTemplateColumns: '4.5rem 1fr auto',
    gap: '10px',
    padding: '7px 2px',
    color: 'var(--ink-1)',
    textDecoration: 'none',
    fontSize: '13px',
  },
  '& a:hover': { background: 'var(--paper-2)' },
})

const resultIcaoStyle = css({ fontWeight: 700, letterSpacing: '0.04em' })

const resultStateStyle = css({ color: 'var(--ink-3)' })

const emptyStyle = css({
  margin: '8px 0 0',
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const mapNoteStyle = css({
  position: 'absolute',
  top: '12px',
  right: '14px',
  margin: 0,
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  zIndex: 2,
})

const railStyle = css({
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  borderInlineStart: '1px solid var(--line)',
  background: 'var(--paper)',
  '@media (max-width: 900px)': {
    borderInlineStart: 0,
    borderBlockStart: '1px solid var(--line)',
  },
})

const chatSlotStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflow: 'hidden',
})

const footerStyle = css({
  padding: '10px 18px 12px',
  borderBlockStart: '1px solid var(--line)',
  fontSize: '10px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
  '& p': { margin: '0 0 4px' },
})
