import type { FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type { MapLayers, ResolveSuggestion } from '#app/lib/api-types.ts'
import { type IslandLayers, islandLayers } from '#app/lib/map-data.ts'
import { toDarkMonochrome } from '#app/lib/monochrome.ts'
import { RADAR_ATTRIBUTION } from '#app/lib/radar.ts'
import { routes } from '#app/routes.ts'
import { type Anchor, session } from '#app/ui/public/session.ts'

const LIBRARY_URL = '/vendor/maplibre/maplibre-gl.mjs'
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const MOVE_DEBOUNCE_MS = 250
const PAPER = '#09090a'
/** The one hue on the map belongs to the hazard polygons, not the chrome. */
const HAZARD_INK = '#e0603f'
/** The selected station's dot: a cool hue, so it is neither paper nor shadow. */
const SELECTION_INK = '#7ec7d6'
/**
 * The opening view: the contiguous states with room around them. Alaska,
 * Hawaii and the territories are a pan away, inside the limit below.
 */
const US_MAINLAND: [[number, number], [number, number]] = [
  [-127, 23],
  [-65, 50],
]
/**
 * How far the camera may travel: the country and its territories, the
 * Aleutians to the Virgin Islands, with room around them so the opening view
 * can sit inside the frame and panning still stops short of Europe.
 */
const US_LIMIT: [[number, number], [number, number]] = [
  [-180, 12],
  [-42, 77],
]
/** Room between the country and the frame on the opening view. */
const US_PADDING = 56

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
        bounds: US_MAINLAND,
        fitBoundsOptions: { padding: US_PADDING },
        minZoom: 2.5,
        maxZoom: 10,
        maxBounds: US_LIMIT,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: {
          compact: true,
          customAttribution: `${RADAR_ATTRIBUTION} · Wind, temperature and humidity: <a href="https://open-meteo.com/">Open-Meteo</a> (RRFS)`,
        },
      })

      map.addControl(
        new maplibre.NavigationControl({ showCompass: false }),
        'bottom-left',
      )

      let moveTimer: ReturnType<typeof setTimeout> | undefined
      let selectedPoint: [number, number] | null = null

      // The server text is for a browser without JavaScript; from here it is
      // only a loading note until the first style is ready.
      if (fallback) fallback.textContent = 'Loading map…'

      // The ask bar and the search both select; the map only draws what the
      // session holds. A selection that moves the marker also moves the view.
      let applySession = (): void => {
        let station = session.selected
        showSuggested(map, session.suggested)

        if (station === null || station.lat === null || station.lon === null) {
          selectedPoint = null
          showSelection(map, null)
          session.setAnchor(null)
          return
        }

        let point: [number, number] = [station.lon, station.lat]
        let moved =
          selectedPoint === null ||
          selectedPoint[0] !== point[0] ||
          selectedPoint[1] !== point[1]

        selectedPoint = point
        showSelection(map, point)
        session.setAnchor(anchorAt(map, point))

        if (moved) {
          // The answer panel covers the right edge, so center the station in
          // the part of the map the reader can still see.
          map.flyTo({
            center: point,
            zoom: Math.max(map.getZoom(), 8),
            padding:
              window.innerWidth > 900 ? { right: 520, top: 0 } : undefined,
            duration: 900,
          })
        }
      }

      map.on('load', () => {
        if (signal.aborted) return

        addAdvisoryLayers(map, handle.props.initial)
        addMarkers(map)
        applySession()
        fallback?.remove()
      })

      // An empty click asks about the place around it; a click on a station
      // keeps its own handler and never opens the area.
      map.on('click', (event) => {
        let hit = map.queryRenderedFeatures(event.point, {
          layers: ['suggested-ring', 'selection-dot'],
        })
        if (hit.length > 0) return

        let { lat, lng } = event.lngLat
        void session.openArea({
          x: event.point.x,
          y: event.point.y,
          lat,
          lon: lng,
        })
      })

      // Keep the station card and its highlight over the dot as the map moves.
      map.on('move', () => {
        if (selectedPoint === null) return
        session.setAnchor(anchorAt(map, selectedPoint))
      })

      session.addEventListener('change', applySession, {
        signal: handle.signal,
      })

      map.on('moveend', () => {
        clearTimeout(moveTimer)
        moveTimer = setTimeout(() => {
          void refreshAdvisories(map)
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

/** The selected station and any fresh alternative, and nothing else. */
function addMarkers(map: MapLibreMap): void {
  map.addSource('suggested', {
    type: 'geojson',
    data: emptyCollection(),
  })
  map.addLayer({
    id: 'suggested-ring',
    type: 'circle',
    source: 'suggested',
    paint: {
      'circle-radius': 8,
      'circle-color': 'rgba(0, 0, 0, 0)',
      'circle-stroke-color': '#a6a6a1',
      'circle-stroke-width': 1.2,
      'circle-stroke-opacity': 0.85,
    },
  })

  map.addSource('selection', {
    type: 'geojson',
    data: emptyCollection(),
  })
  map.addLayer({
    id: 'selection-dot',
    type: 'circle',
    source: 'selection',
    paint: {
      'circle-radius': 7,
      'circle-color': SELECTION_INK,
    },
  })

  map.on('click', 'suggested-ring', (event) => {
    let icao = event.features?.[0]?.properties?.icao
    if (typeof icao === 'string') void session.select(icao)
  })
  map.on('mouseenter', 'suggested-ring', () => {
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'suggested-ring', () => {
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
    paint: { 'line-color': HAZARD_INK, 'line-width': 1 },
  })
}

async function refreshAdvisories(map: MapLibreMap): Promise<void> {
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

    let advisories = map.getSource('advisories') as GeoJSONSource | undefined
    advisories?.setData(advisoriesOf(islandLayers(payload.data)))
  } catch {
    // A failed viewport fetch leaves the last drawn layer in place.
  }
}

function anchorAt(map: MapLibreMap, point: [number, number]): Anchor {
  let projected = map.project(point)
  // Metres per pixel at this latitude, so the weather area is a real distance
  // on the map rather than a fixed size on the screen.
  let metersPerPixel =
    (156543.03392 * Math.cos((point[1] * Math.PI) / 180)) / 2 ** map.getZoom()
  return {
    x: projected.x,
    y: projected.y,
    pxPerNm: 1852 / metersPerPixel,
    bearing: map.getBearing(),
  }
}

function showSelection(map: MapLibreMap, point: [number, number] | null): void {
  let source = map.getSource('selection') as GeoJSONSource | undefined
  source?.setData(featureCollection(point === null ? [] : [point]))
}

function showSuggested(map: MapLibreMap, stations: ResolveSuggestion[]): void {
  let source = map.getSource('suggested') as GeoJSONSource | undefined
  source?.setData({
    type: 'FeatureCollection',
    features: stations.map((station) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [station.lon, station.lat] },
      properties: { icao: station.icao },
    })),
  })
}

function emptyCollection(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function featureCollection(points: [number, number][]): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((point) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: point },
      properties: {},
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
  context.strokeStyle = HAZARD_INK
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
  // MapLibre ships unlayered CSS and these rules are layered, so every
  // override of its own chrome has to be important to win the cascade.
  '& .maplibregl-ctrl-group': {
    background: 'rgba(20, 20, 24, 0.68) !important',
    border: '1px solid var(--glass-border) !important',
    borderRadius: '14px !important',
    overflow: 'hidden',
    boxShadow: '0 12px 30px rgba(0, 0, 0, 0.4) !important',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  },
  '& .maplibregl-ctrl-group button': {
    background: 'transparent !important',
    filter: 'invert(1)',
  },
  '& .maplibregl-ctrl-group button + button': {
    borderBlockStart: '1px solid var(--glass-border)',
  },
  '& .maplibregl-ctrl-attrib.maplibregl-compact': {
    background: 'rgba(20, 20, 24, 0.72) !important',
    color: 'var(--ink-3) !important',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  '& .maplibregl-ctrl-attrib.maplibregl-compact-show': {
    background: 'rgba(20, 20, 24, 0.88) !important',
  },
  '& .maplibregl-ctrl-attrib a': { color: 'var(--ink-2) !important' },
  '& .maplibregl-ctrl-attrib-button': {
    backgroundColor: 'transparent !important',
    filter: 'invert(1)',
  },
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
