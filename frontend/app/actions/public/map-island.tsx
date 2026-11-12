import type { FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type {
  MapLayers,
  ResolveSuggestion,
  AreaStation,
} from '#app/lib/api-types.ts'
import { type IslandLayers, islandLayers } from '#app/lib/map-data.ts'
import { toDarkMonochrome } from '#app/lib/monochrome.ts'
import { pixelsPerNm } from '#app/lib/public/field-stations.ts'
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
/** Mean Earth radius in nautical miles, for the area circle. */
const EARTH_RADIUS_NM = 3440.065
/** Each map's area tooltip, so a changed area can close the last one. */
const tips = new WeakMap<MapLibreMap, import('maplibre-gl').Popup>()

/** The hover card for a station dot: who it is, and how far away. */
function stationTip(
  icao: string,
  name: string,
  distanceNm: number | null,
): HTMLElement {
  let node = document.createElement('div')
  node.className = 'station-tip'

  let code = document.createElement('strong')
  code.textContent = icao
  node.append(code)

  let label = document.createElement('div')
  label.textContent = name
  node.append(label)

  if (distanceNm !== null) {
    let distance = document.createElement('div')
    distance.className = 'station-tip-muted'
    distance.textContent = `${distanceNm} nm from the click`
    node.append(distance)
  }

  return node
}
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
      let areaPoint: [number, number] | null = null

      // The server text is for a browser without JavaScript; from here it is
      // only a loading note until the first style is ready.
      if (fallback) fallback.textContent = 'Loading map…'

      // The ask bar and the search both select; the map only draws what the
      // session holds. A selection that moves the marker also moves the view.
      let applySession = (): void => {
        let station = session.selected
        showSuggested(map, session.suggested)
        showArea(
          map,
          session.area === null
            ? null
            : {
                lat: session.area.lat,
                lon: session.area.lon,
                radiusNm: session.areaPayload?.radius_nm ?? null,
                stations: session.areaPayload?.stations ?? [],
              },
        )

        if (station === null || station.lat === null || station.lon === null) {
          selectedPoint = null
          showSelection(map, null)
          // The area draws its own weather from the click, so the field
          // needs an anchor there too.
          areaPoint =
            session.area === null ? null : [session.area.lon, session.area.lat]
          session.setAnchor(
            areaPoint === null ? null : anchorAt(map, areaPoint),
          )
          return
        }

        areaPoint = null
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
        addMarkers(map, maplibre)
        applySession()
        fallback?.remove()
      })

      // An empty click asks about the place around it; a click on a station
      // keeps its own handler and never opens the area.
      map.on('click', (event) => {
        let hit = map.queryRenderedFeatures(event.point, {
          layers: ['suggested-ring', 'selection-dot', 'area-stations'],
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

      // Keep the weather field over its point, and the card over its dot.
      map.on('move', () => {
        if (selectedPoint !== null) {
          session.setAnchor(anchorAt(map, selectedPoint))
        } else if (areaPoint !== null) {
          session.setAnchor(anchorAt(map, areaPoint))
        }
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
function addMarkers(
  map: MapLibreMap,
  maplibre: typeof import('maplibre-gl'),
): void {
  map.addSource('area-window', {
    type: 'geojson',
    data: emptyCollection(),
  })
  map.addLayer({
    id: 'area-fill',
    type: 'fill',
    source: 'area-window',
    paint: { 'fill-color': SELECTION_INK, 'fill-opacity': 0.05 },
  })
  map.addLayer({
    id: 'area-ring',
    type: 'line',
    source: 'area-window',
    paint: {
      'line-color': SELECTION_INK,
      'line-width': 1,
      'line-opacity': 0.6,
      'line-dasharray': [3, 3],
    },
  })

  map.addSource('area-point', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'area-point',
    type: 'circle',
    source: 'area-point',
    paint: {
      'circle-radius': 4,
      'circle-color': '#f2f2ee',
      'circle-stroke-color': PAPER,
      'circle-stroke-width': 1.5,
    },
  })

  map.addSource('area-stations', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'area-stations',
    type: 'circle',
    source: 'area-stations',
    paint: {
      'circle-radius': 4,
      'circle-color': '#93b8c2',
      'circle-stroke-color': PAPER,
      'circle-stroke-width': 1,
      'circle-opacity': 0.95,
    },
  })

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

  // A station inside the area point: hover names it, click reads it.
  let tip = new maplibre.Popup({
    closeButton: false,
    closeOnClick: false,
    offset: 10,
  })
  tips.set(map, tip)

  map.on('mouseenter', 'area-stations', (event) => {
    let feature = event.features?.[0]
    if (feature === undefined) return

    let { icao, name, distance_nm } = (feature.properties ?? {}) as {
      icao?: string
      name?: string
      distance_nm?: number
    }
    if (typeof icao !== 'string' || typeof name !== 'string') return

    let geometry = feature.geometry
    if (!geometry || !('coordinates' in geometry)) return
    let coordinates = geometry.coordinates as [number, number]

    tip
      .setLngLat(coordinates)
      .setDOMContent(stationTip(icao, name, distance_nm ?? null))
      .addTo(map)
    map.getCanvas().style.cursor = 'pointer'
  })
  map.on('mouseleave', 'area-stations', () => {
    tip.remove()
    map.getCanvas().style.cursor = ''
  })
  map.on('click', 'area-stations', (event) => {
    let icao = event.features?.[0]?.properties?.icao
    if (typeof icao === 'string') void session.select(icao)
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
  return {
    x: projected.x,
    y: projected.y,
    pxPerNm: pixelsPerNm(point[1], map.getZoom()),
    bearing: map.getBearing(),
  }
}

function showSelection(map: MapLibreMap, point: [number, number] | null): void {
  let source = map.getSource('selection') as GeoJSONSource | undefined
  source?.setData(featureCollection(point === null ? [] : [point]))
}

/** The window around a click: the ring, the clicked point and its stations. */
function showArea(
  map: MapLibreMap,
  area: {
    lat: number
    lon: number
    radiusNm: number | null
    stations: AreaStation[]
  } | null,
): void {
  let ring = map.getSource('area-window') as GeoJSONSource | undefined
  let point = map.getSource('area-point') as GeoJSONSource | undefined
  let dots = map.getSource('area-stations') as GeoJSONSource | undefined

  tips.get(map)?.remove()

  ring?.setData(
    area === null || area.radiusNm === null
      ? emptyCollection()
      : areaWindow(area.lat, area.lon, area.radiusNm),
  )
  point?.setData(
    area === null
      ? emptyCollection()
      : featureCollection([[area.lon, area.lat]]),
  )
  dots?.setData(
    area === null
      ? emptyCollection()
      : {
          type: 'FeatureCollection',
          features: area.stations.map((station) => ({
            type: 'Feature',
            geometry: {
              type: 'Point',
              coordinates: [station.lon, station.lat],
            },
            properties: {
              icao: station.icao,
              name: station.name,
              distance_nm: station.distance_nm,
            },
          })),
        },
  )
}

function areaWindow(
  lat: number,
  lon: number,
  radiusNm: number,
): FeatureCollection {
  // A circle on the sphere: walk the radius round the click and connect it.
  let steps = 72
  let angular = radiusNm / EARTH_RADIUS_NM
  let latRad = (lat * Math.PI) / 180
  let lonRad = (lon * Math.PI) / 180
  let ring: [number, number][] = []

  for (let step = 0; step <= steps; step += 1) {
    let bearing = (step / steps) * 2 * Math.PI
    let toLat = Math.asin(
      Math.sin(latRad) * Math.cos(angular) +
        Math.cos(latRad) * Math.sin(angular) * Math.cos(bearing),
    )
    let toLon =
      lonRad +
      Math.atan2(
        Math.sin(bearing) * Math.sin(angular) * Math.cos(latRad),
        Math.cos(angular) - Math.sin(latRad) * Math.sin(toLat),
      )

    ring.push([(toLon * 180) / Math.PI, (toLat * 180) / Math.PI])
  }

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [ring] },
        properties: {},
      },
    ],
  }
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
