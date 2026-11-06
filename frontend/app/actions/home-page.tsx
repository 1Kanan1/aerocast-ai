import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type {
  MapLayersResponse,
  StationList as StationListResponse,
} from '../lib/api-types.ts'
import type { ApiResult } from '../lib/api.ts'
import { EMPTY_LAYERS, islandLayers } from '../lib/map-data.ts'
import { routes } from '../routes.ts'
import {
  cardStyle,
  headingStyle,
  mutedStyle,
  Page,
  subheadingStyle,
} from '../ui/layout.tsx'
import { MapIsland } from './public/map-island.tsx'

interface HomePageProps {
  layers: ApiResult<MapLayersResponse>
  query: string
  stations: ApiResult<StationListResponse>
}

export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    let { layers, query, stations } = handle.props
    let rows = stations.data?.data ?? []
    let island = layers.data ? islandLayers(layers.data.data) : EMPTY_LAYERS

    return (
      <Page active="map">
        <section>
          <h1 mix={headingStyle}>Aviation weather, explained and cited.</h1>
          <p mix={ledeStyle}>
            METAR, TAF, advisories and a 48 hour history for US airports. Every
            sentence the explanation layer produces points back at the
            observation it came from. Nothing here decides whether you should
            fly.
          </p>
        </section>

        <section aria-labelledby="map-heading" mix={cardStyle}>
          <h2 id="map-heading" mix={subheadingStyle}>
            Map
          </h2>
          <MapIsland initial={island} />
          <p mix={mapNoteStyle}>
            Flight category is a grey ramp; letters appear as you zoom in.
            Hatched outlines are active advisories. Not for navigation.
          </p>
        </section>

        <section aria-labelledby="stations-heading">
          <h2 id="stations-heading" mix={subheadingStyle}>
            Stations
          </h2>
          <form action={routes.home.href()} method="get" mix={searchStyle}>
            <label mix={labelStyle}>
              <span>Search by ICAO, name or state</span>
              <input
                defaultValue={query}
                name="q"
                placeholder="KSFO"
                type="search"
              />
            </label>
            <button mix={buttonStyle} type="submit">
              Search
            </button>
          </form>

          {!stations.ok ? (
            <p mix={mutedStyle}>
              The API is unavailable right now, so the station list cannot be
              loaded.
            </p>
          ) : rows.length === 0 ? (
            <p mix={mutedStyle}>No stations match this search.</p>
          ) : (
            <ul mix={listStyle}>
              {rows.map((station) => (
                <li key={station.icao}>
                  <a href={routes.station.href({ icao: station.icao })}>
                    <span mix={icaoStyle}>{station.icao}</span>
                    <span>{station.name}</span>
                    <span mix={mutedStyle}>{station.state ?? ''}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Page>
    )
  }
}

const ledeStyle = css({
  margin: 0,
  maxWidth: '62ch',
  color: 'var(--ink-2)',
})

const labelStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  flex: '1 1 14rem',
  color: 'var(--ink-3)',
  '& input': {
    padding: '8px 10px',
    border: '1px solid var(--line)',
    borderRadius: '6px',
    background: 'var(--paper)',
    color: 'var(--ink-0)',
    font: 'inherit',
  },
})

const buttonStyle = css({
  alignSelf: 'flex-end',
  padding: '8px 14px',
  border: '1px solid var(--ink-0)',
  borderRadius: '6px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  cursor: 'pointer',
})

const searchStyle = css({
  display: 'flex',
  alignItems: 'flex-end',
  gap: '10px',
  flexWrap: 'wrap',
  marginBlockEnd: '14px',
})

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  borderBlockStart: '1px solid var(--line)',
  '& li': { borderBlockEnd: '1px solid var(--line)' },
  '& a': {
    display: 'grid',
    gridTemplateColumns: '4.5rem 1fr auto',
    gap: '12px',
    padding: '9px 2px',
    color: 'var(--ink-1)',
    textDecoration: 'none',
  },
  '& a:hover': { background: 'var(--paper-2)' },
})

const icaoStyle = css({ fontWeight: 700, letterSpacing: '0.04em' })

const mapNoteStyle = css({
  margin: '10px 0 0',
  fontSize: '12px',
  color: 'var(--ink-3)',
})
