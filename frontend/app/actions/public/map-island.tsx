import type { FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type { MapLayers } from '../../lib/api-types.ts'
import {
  type IslandLayers,
  islandLayers,
} from '../../lib/map-data.ts'
import { toDarkMonochrome } from '../../lib/monochrome.ts'
import {
  CATEGORY_BADGES,
  CATEGORY_SHADES,
} from '../../lib/public/categories.ts'
import { routes } from '../../routes.ts'
import { type Anchor, session } from '../../ui/public/session.ts'

const LIBRARY_URL = '/vendor/maplibre/maplibre-gl.mjs'
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const MOVE_DEBOUNCE_MS = 250
const PAPER = '#09090a'
const ACCENT = '#e0603f'

interface MapIslandProps {
  initial: IslandLayers
}

/**
 * The only browser island. Everything it draws is server-provided first, and
 * a viewport change refetches through the same-origin proxy.
 */
export const MapIsland = clientEntry(
  import.meta.url,
  function MapIsland(handle: Handle<MapIslandProps>) {
    let container: HTMLElement | undefined
    let fallback: HTMLElement | undefined

    handle.queueTask(async (signal) => {
      if (!container) return

      let maplibre: typeof import('maplibre-gl')
      try {
        maplibre = (await import(LIBRARY_URL)) as typeof import('maplibre-gl')
      } catch {
        if (fallback) fallback.textContent = 'The map library did not load.'
        return
      }

      let style = await loadStyle(signal)
      if (signal.aborted || !container) return

      let map = new maplibre.Map({
        container,
        style: style ?? emptyStyle(),
        center: [-96, 38],
        zoom: 3.4,
        minZoom: 2.5,
        maxZoom: 10,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true },
      })

      map.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        'bottom-left',
      )

      let moveTimer: ReturnType<typeof setTimeout> | undefined
      let points = stationPoints(handle.props.initial)
      let selectedIcao: string | null = null

      // The server text is for a browser without JavaScript; from here it is
      // only a loading note until the first style is ready.
      if (fallback) fallback.textContent = 'Loading map…'

      map.on('load', () => {
        if (signal.aborted) return

        addAdvisoryLayers(map, handle.props.initial)
        addStationLayers(map, handle.props.initial)
        fallback?.remove()
      })

      // Keep the station card and its highlight over the dot as the map moves.
      map.on('move', () => {
        if (selectedIcao === null) return
        let point = points.get(selectedIcao)
        if (!point) return
        session.setAnchor(project(map, point))
      })

      // The card clears the selection on close. A new selection (from a dot or
      // from search) sets the highlight and the anchor here, in one place.
      session.addEventListener(
        'change',
        () => {
          let station = session.selected
          if (station === null) {
            if (selectedIcao !== null) markSelected(map, selectedIcao, false)
            selectedIcao = null
            session.setAnchor(null)
            return
          }

          if (station.icao === selectedIcao) return
          if (selectedIcao !== null) markSelected(map, selectedIcao, false)
          selectedIcao = station.icao
          markSelected(map, selectedIcao, true)

          let point = points.get(station.icao)
          if (point) session.setAnchor(project(map, point))
        },
        { signal: handle.signal },
      )

      map.on('moveend', () => {
        clearTimeout(moveTimer)
        moveTimer = setTimeout(() => {
          void refresh(map, points)
        }, MOVE_DEBOUNCE_MS)
      })

      handle.signal.addEventListener('abort', () => {
        clearTimeout(moveTimer)
        map.remove()
      })
    })

    return () => (
      <div mix={frameStyle}>
        <div mix={[mapStyle, ref((node) => (container = node))]} />
        <p mix={[fallbackStyle, ref((node) => (fallback = node))]}>
          The map needs JavaScript. The station list below covers the same
          airports.
        </p>
      </div>
    )
  },
)

async function loadStyle(
  signal: AbortSignal,
): Promise<StyleSpecification | null> {
  try {
    let response = await fetch(STYLE_URL, { signal })
    if (!response.ok) return null
    return toDarkMonochrome((await response.json()) as StyleSpecification)
  } catch {
    return null
  }
}

function emptyStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'paper',
        type: 'background',
        paint: { 'background-color': PAPER },
      },
    ],
  }
}

function addStationLayers(map: MapLibreMap, data: IslandLayers): void {
  map.addSource('stations', {
    type: 'geojson',
    data: stationsOf(data),
    promoteId: 'icao',
  })

  map.addLayer({
    id: 'stations-halo',
    type: 'circle',
    source: 'stations',
    filter: ['boolean', ['feature-state', 'selected'], false],
    paint: {
      'circle-radius': 11,
      'circle-color': 'rgba(224, 96, 63, 0)',
      'circle-stroke-color': ACCENT,
      'circle-stroke-width': 2,
    },
  })

  map.addLayer({
    id: 'stations-dots',
    type: 'circle',
    source: 'stations',
    paint: {
      'circle-radius': 5,
      'circle-color': [
        'match',
        ['get', 'category'],
        'VFR',
        CATEGORY_SHADES.VFR,
        'MVFR',
        CATEGORY_SHADES.MVFR,
        'IFR',
        CATEGORY_SHADES.IFR,
        'LIFR',
        CATEGORY_SHADES.LIFR,
        '#9a9a9a',
      ],
      'circle-stroke-color': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        ACCENT,
        PAPER,
      ],
      'circle-stroke-width': [
        'case',
        ['boolean', ['feature-state', 'selected'], false],
        2.5,
        1.5,
      ],
    },
  })

  // Glyphs come from the basemap style, so an offline fallback has none.
  if (map.getStyle().glyphs) {
    map.addLayer({
      id: 'stations-badges',
      type: 'symbol',
      source: 'stations',
      minzoom: 5,
      layout: {
        'text-field': ['get', 'badge'],
        'text-size': 9,
        'text-offset': [0, -1.1],
        'text-anchor': 'top',
        'text-allow-overlap': true,
        'text-font': ['Noto Sans Regular'],
      },
      paint: { 'text-color': '#f4f4f2', 'text-halo-color': PAPER },
    })
  }

  map.on('click', 'stations-dots', (event) => {
    // One station at a time: the card must be closed before another is picked.
    if (session.selected !== null) return

    let icao = event.features?.[0]?.properties?.icao
    if (typeof icao === 'string') void session.select(icao)
  })
  map.on('mouseenter', 'stations-dots', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'stations-dots', () => {
    map.getCanvas().style.cursor = ''
  })
}

function addAdvisoryLayers(map: MapLibreMap, data: IslandLayers): void {
  map.addImage('advisory-hatch', hatchPattern(), { pixelRatio: 1 })
  map.addSource('advisories', {
    type: 'geojson',
    data: advisoriesOf(data),
  })
  map.addLayer({
    id: 'advisories-fill',
    type: 'fill',
    source: 'advisories',
    paint: { 'fill-pattern': 'advisory-hatch', 'fill-opacity': 0.75 },
  })
  map.addLayer({
    id: 'advisories-outline',
    type: 'line',
    source: 'advisories',
    paint: { 'line-color': ACCENT, 'line-width': 1 },
  })
}

async function refresh(
  map: MapLibreMap,
  points: Map<string, [number, number]>,
): Promise<void> {
  let bounds = map.getBounds()
  let bbox = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ]
    .map((value) => value.toFixed(4))
    .join(',')

  try {
    let response = await fetch(`${routes.layers.href()}?bbox=${bbox}`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return

    let payload = (await response.json()) as { data?: MapLayers }
    if (!payload.data) return

    let data = islandLayers(payload.data)
    let stations = map.getSource('stations') as GeoJSONSource | undefined
    let advisories = map.getSource('advisories') as GeoJSONSource | undefined
    stations?.setData(stationsOf(data))
    advisories?.setData(advisoriesOf(data))

    for (let [icao, point] of stationPoints(data)) points.set(icao, point)
  } catch {
    // A failed viewport fetch leaves the last drawn layer in place.
  }
}

function stationPoints(
  data: IslandLayers,
): Map<string, [number, number]> {
  let points = new Map<string, [number, number]>()
  for (let station of data.stations) {
    points.set(station.icao, [station.lon, station.lat])
  }
  return points
}

function project(map: MapLibreMap, point: [number, number]): Anchor {
  let projected = map.project(point)
  return { x: projected.x, y: projected.y }
}

function markSelected(
  map: MapLibreMap,
  icao: string,
  selected: boolean,
): void {
  try {
    map.setFeatureState({ source: 'stations', id: icao }, { selected })
  } catch {
    // The source is rebuilt on viewport refresh; a missing id is harmless.
  }
}

function stationsOf(data: IslandLayers): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.stations.map((station) => ({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [station.lon, station.lat],
      },
      properties: {
        icao: station.icao,
        category: station.category,
        badge: CATEGORY_BADGES[station.category ?? ''] ?? '?',
      },
    })),
  }
}

function advisoriesOf(data: IslandLayers): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.advisories.map((advisory) => ({
      type: 'Feature',
      geometry: advisory.geometry as unknown as Geometry,
      properties: {
        hazard: advisory.hazard,
        kind: advisory.kind,
        source_id: advisory.source_id,
      },
    })),
  }
}

/** Diagonal hatch, drawn once so advisory fills are never a color alone. */
function hatchPattern(): ImageData {
  let size = 8
  let canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  let context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  context.strokeStyle = ACCENT
  context.globalAlpha = 0.45
  context.lineWidth = 1
  context.beginPath()
  context.moveTo(-2, size + 2)
  context.lineTo(size + 2, -2)
  context.stroke()
  return context.getImageData(0, 0, size, size)
}

const frameStyle = css({ position: 'absolute', inset: 0 })

const mapStyle = css({
  height: '100%',
  width: '100%',
  background: 'var(--paper)',
  '& .maplibregl-ctrl-group': {
    background: 'rgba(20, 20, 24, 0.68)',
    border: '1px solid var(--glass-border)',
    borderRadius: '14px',
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4)',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  },
  '& .maplibregl-ctrl-group button': {
    background: 'transparent',
    filter: 'invert(1)',
  },
  '& .maplibregl-ctrl-group button + button': {
    borderBlockStart: '1px solid var(--glass-border)',
  },
  '& .maplibregl-ctrl-attrib': {
    background: 'rgba(20, 20, 24, 0.62)',
    color: 'var(--ink-3)',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  '& .maplibregl-ctrl-attrib a': { color: 'var(--ink-2)' },
  '& .maplibregl-ctrl-attrib-button': { filter: 'invert(1)' },
})

const fallbackStyle = css({
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: 0,
  padding: '24px',
  color: 'var(--ink-3)',
  textAlign: 'center',
})
