import type { FeatureCollection, Geometry } from 'geojson'
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type {
  AreaStation,
  MapLayers,
  ResolveSuggestion,
} from '#app/lib/api-types.ts'
import { timeLabel } from '#app/lib/format.ts'
import { type IslandLayers, islandLayers } from '#app/lib/map-data.ts'
import { toDarkMonochrome, toMonochrome } from '#app/lib/monochrome.ts'
import { CATEGORY_DOTS } from '#app/lib/public/categories.ts'
import { pixelsPerNm } from '#app/lib/public/field-stations.ts'
import {
  AREA_NM,
  prefetchRadarWindow,
  RADAR_ATTRIBUTION,
  stationsToWarm,
} from '#app/lib/radar.ts'
import { routes } from '#app/routes.ts'
import { type Anchor, session } from '#app/ui/public/session.ts'
import { cameraPadding } from '#app/ui/public/sheet-drag.ts'
import { theme } from '#app/ui/public/theme.ts'
import { weatherLayers } from '#app/ui/public/weather-layers.ts'

const LIBRARY_URL = '/vendor/maplibre/maplibre-gl.mjs'
const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const MOVE_DEBOUNCE_MS = 250
const DARK_PAPER = '#0b0c0e'
const LIGHT_PAPER = '#f4f6f9'
const HAZARD_INK = '#c96f55'
const SELECTION_INK = '#7ec7d6'
const EARTH_RADIUS_NM = 3440.065

const tips = new WeakMap<MapLibreMap, import('maplibre-gl').Popup>()
const advisoryPopups = new WeakMap<MapLibreMap, import('maplibre-gl').Popup>()

/** The hover card for a station dot: code, optional category, name, distance. */
function stationTip(
  icao: string,
  name: string,
  distanceNm: number | null,
  category: string | null = null,
): HTMLElement {
  let node = document.createElement('div')
  node.className = 'station-tip'

  let head = document.createElement('div')
  head.className = 'station-tip-head'

  let code = document.createElement('strong')
  code.textContent = icao
  head.append(code)

  if (category) {
    let badge = document.createElement('span')
    badge.className = 'station-tip-cat'
    badge.textContent = category
    badge.style.color = CATEGORY_DOTS[category] ?? 'var(--ink-2)'
    head.append(badge)
  }
  node.append(head)

  let label = document.createElement('div')
  label.textContent = name
  node.append(label)

  if (distanceNm !== null) {
    let distance = document.createElement('div')
    distance.className = 'station-tip-muted'
    distance.textContent = `${distanceNm} nm from click`
    node.append(distance)
  }

  return node
}

function advisoryTip(props: {
  hazard?: string
  kind?: string
  source_id?: string
  severity?: string | null
  base_ft?: number | null
  top_ft?: number | null
  due_to?: string | null
  valid_to?: string | null
}): HTMLElement {
  let node = document.createElement('div')
  node.className = 'advisory-tip'

  let title = document.createElement('strong')
  title.textContent =
    `${props.hazard ?? 'Advisory'} · ${(props.kind ?? '').toUpperCase()} ${props.source_id ?? ''}`.trim()
  node.append(title)

  if (props.due_to) {
    let due = document.createElement('div')
    due.textContent = props.due_to
    node.append(due)
  }

  let details: string[] = []
  if (props.severity) details.push(props.severity)
  if (props.base_ft != null && props.top_ft != null) {
    details.push(
      `${props.base_ft.toLocaleString()}–${props.top_ft.toLocaleString()} ft`,
    )
  } else if (props.top_ft != null) {
    details.push(`to ${props.top_ft.toLocaleString()} ft`)
  }
  if (props.valid_to) {
    details.push(`until ${timeLabel(props.valid_to)}`)
  }
  if (details.length > 0) {
    let meta = document.createElement('div')
    meta.className = 'station-tip-muted'
    meta.textContent = details.join(' · ')
    node.append(meta)
  }

  return node
}

const US_MAINLAND: [[number, number], [number, number]] = [
  [-127, 23],
  [-65, 50],
]

const US_LIMIT: [[number, number], [number, number]] = [
  [-180, 12],
  [-42, 77],
]

const US_PADDING = 56

interface MapIslandProps {
  initial: IslandLayers
}

/**
 * Full-bleed MapLibre GL canvas with theme-aware monochrome tiles, toggleable
 * FAA-colored airport dots (off by default), clickable advisory polygons, and
 * URL selection restore.
 */
export const MapIsland = clientEntry(
  import.meta.url,
  function MapIsland(handle: Handle<MapIslandProps>) {
    let container: HTMLElement | undefined
    let fallback: HTMLElement | undefined

    handle.queueTask(async (signal) => {
      handle.signal.addEventListener('abort', () => session.detach(), {
        once: true,
      })
      if (!container) return

      let maplibre: typeof import('maplibre-gl')
      try {
        maplibre = (await import(LIBRARY_URL)) as typeof import('maplibre-gl')
      } catch {
        if (fallback) fallback.textContent = 'The map library did not load.'
        return
      }

      let rawStyle = await loadRawStyle(signal)
      if (signal.aborted || !container) return

      let currentTheme = theme.resolved
      let latestLayers: IslandLayers = handle.props.initial
      let buildStyle = (): StyleSpecification =>
        rawStyle
          ? currentTheme === 'dark'
            ? toDarkMonochrome(rawStyle)
            : toMonochrome(rawStyle)
          : emptyStyle(currentTheme)

      let map = new maplibre.Map({
        container,
        style: buildStyle(),
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

      if (fallback) fallback.textContent = 'Loading map…'

      let applySession = (): void => {
        let station = session.selected
        showSuggested(map, session.suggested)
        warmSuggested(session.suggested)
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
          let next: [number, number] | null =
            session.area === null ? null : [session.area.lon, session.area.lat]
          let moved =
            next !== null &&
            (areaPoint === null ||
              areaPoint[0] !== next[0] ||
              areaPoint[1] !== next[1])
          areaPoint = next
          session.setAnchor(
            areaPoint === null ? null : anchorAt(map, areaPoint),
          )

          if (moved && next !== null && session.area?.focus === true) {
            map.flyTo({
              center: next,
              zoom: Math.max(map.getZoom(), 8),
              padding: cameraPadding(window.innerWidth, window.innerHeight),
              duration: 900,
            })
          }
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
          map.flyTo({
            center: point,
            zoom: Math.max(map.getZoom(), 8),
            padding: cameraPadding(window.innerWidth, window.innerHeight),
            duration: 900,
          })
        }
      }

      let mountOverlays = (): void => {
        if (signal.aborted) return
        addAdvisoryLayers(map, latestLayers, weatherLayers.advisories)
        addStationDots(map, latestLayers, currentTheme, weatherLayers.stations)
        addMarkers(map)
        applySession()
      }

      let bindLayerInteractions = (): void => {
        let tip = new maplibre.Popup({
          closeButton: false,
          closeOnClick: false,
          offset: 10,
        })
        tips.set(map, tip)

        let advPopup = new maplibre.Popup({
          closeButton: true,
          closeOnClick: true,
          maxWidth: '280px',
        })
        advisoryPopups.set(map, advPopup)

        map.on('mouseenter', 'viewport-stations-dots', (event) => {
          if (!weatherLayers.stations) return
          let feature = event.features?.[0]
          if (feature === undefined) return
          let { icao, name, category } = (feature.properties ?? {}) as {
            icao?: string
            name?: string
            category?: string | null
          }
          if (typeof icao !== 'string' || typeof name !== 'string') return
          let geometry = feature.geometry
          if (!geometry || !('coordinates' in geometry)) return
          tip
            .setLngLat(geometry.coordinates as [number, number])
            .setDOMContent(stationTip(icao, name, null, category ?? null))
            .addTo(map)
          map.getCanvas().style.cursor = 'pointer'
        })
        map.on('mouseleave', 'viewport-stations-dots', () => {
          tip.remove()
          map.getCanvas().style.cursor = ''
        })
        map.on('click', 'viewport-stations-dots', (event) => {
          if (!weatherLayers.stations) return
          let icao = event.features?.[0]?.properties?.icao
          if (typeof icao === 'string') {
            advPopup.remove()
            void session.select(icao)
          }
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
          tip
            .setLngLat(geometry.coordinates as [number, number])
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

        map.on('mouseenter', 'advisories-fill', () => {
          if (!weatherLayers.advisories) return
          if (map.getCanvas().style.cursor === '') {
            map.getCanvas().style.cursor = 'pointer'
          }
        })
        map.on('mouseleave', 'advisories-fill', () => {
          map.getCanvas().style.cursor = ''
        })
      }

      let refreshViewport = async (): Promise<void> => {
        let next = await fetchViewportLayers(map)
        if (next === null || signal.aborted) return
        latestLayers = next
        let advSource = map.getSource('advisories') as GeoJSONSource | undefined
        advSource?.setData(advisoriesOf(next))
        let stnSource = map.getSource('viewport-stations') as
          | GeoJSONSource
          | undefined
        stnSource?.setData(stationsOf(next))
      }

      map.on('load', () => {
        if (signal.aborted) return
        mountOverlays()
        bindLayerInteractions()
        fallback?.remove()
        void session.syncFromUrl()
      })

      theme.addEventListener(
        'change',
        () => {
          if (theme.resolved === currentTheme) return
          currentTheme = theme.resolved
          map.setStyle(buildStyle())
          map.once('style.load', () => {
            mountOverlays()
          })
        },
        { signal: handle.signal },
      )

      let hazardsShown = weatherLayers.advisories
      let stationsShown = weatherLayers.stations
      weatherLayers.addEventListener(
        'change',
        () => {
          let needRefresh = false
          if (weatherLayers.advisories !== hazardsShown) {
            hazardsShown = weatherLayers.advisories
            showAdvisories(map, hazardsShown)
            if (!hazardsShown) advisoryPopups.get(map)?.remove()
            if (hazardsShown) needRefresh = true
          }
          if (weatherLayers.stations !== stationsShown) {
            stationsShown = weatherLayers.stations
            showStations(map, stationsShown)
            if (!stationsShown) tips.get(map)?.remove()
            if (stationsShown) needRefresh = true
          }
          if (needRefresh) void refreshViewport()
        },
        { signal: handle.signal },
      )

      // Priority order on click: visible station dots -> visible advisory -> area
      map.on('click', (event) => {
        let stationLayers = weatherLayers.stations
          ? [
              'viewport-stations-dots',
              'suggested-ring',
              'selection-dot',
              'area-stations',
            ]
          : ['suggested-ring', 'selection-dot', 'area-stations']

        let hit = map.queryRenderedFeatures(event.point, {
          layers: stationLayers,
        })
        if (hit.length > 0) return

        if (weatherLayers.advisories) {
          let advHit = map.queryRenderedFeatures(event.point, {
            layers: ['advisories-fill'],
          })
          if (advHit.length > 0) {
            let props = (advHit[0].properties ?? {}) as {
              hazard?: string
              kind?: string
              source_id?: string
              severity?: string | null
              base_ft?: number | null
              top_ft?: number | null
              due_to?: string | null
              valid_to?: string | null
            }
            advisoryPopups
              .get(map)
              ?.setLngLat(event.lngLat)
              .setDOMContent(advisoryTip(props))
              .addTo(map)
            return
          }
        }

        let { lat, lng } = event.lngLat
        void session.openArea({ lat, lon: lng })
      })

      map.on('move', () => {
        if (selectedPoint !== null) {
          session.moveAnchor(anchorAt(map, selectedPoint))
        } else if (areaPoint !== null) {
          session.moveAnchor(anchorAt(map, areaPoint))
        }
      })

      session.addEventListener('change', applySession, {
        signal: handle.signal,
      })

      map.on('moveend', () => {
        session.settleAnchor()
        clearTimeout(moveTimer)
        if (!weatherLayers.advisories && !weatherLayers.stations) return
        moveTimer = setTimeout(() => {
          void refreshViewport()
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
          The map needs JavaScript. Visit Advisories or a station page
          (/stations/KSFO) for text weather reports.
        </p>
      </div>
    )
  },
)

async function loadRawStyle(
  signal: AbortSignal,
): Promise<StyleSpecification | null> {
  try {
    let response = await fetch(STYLE_URL, { signal })
    if (!response.ok) return null
    return (await response.json()) as StyleSpecification
  } catch {
    return null
  }
}

function emptyStyle(mode: 'light' | 'dark'): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'paper',
        type: 'background',
        paint: {
          'background-color': mode === 'dark' ? DARK_PAPER : LIGHT_PAPER,
        },
      },
    ],
  }
}

function addStationDots(
  map: MapLibreMap,
  data: IslandLayers,
  mode: 'light' | 'dark',
  visible: boolean,
): void {
  map.addSource('viewport-stations', {
    type: 'geojson',
    data: stationsOf(data),
  })
  map.addLayer({
    id: 'viewport-stations-dots',
    type: 'circle',
    source: 'viewport-stations',
    paint: {
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        3,
        3.5,
        6,
        5,
        9,
        6.5,
      ],
      'circle-radius-transition': { duration: 240, delay: 0 },
      'circle-color': [
        'match',
        ['get', 'category'],
        'VFR',
        CATEGORY_DOTS.VFR,
        'MVFR',
        CATEGORY_DOTS.MVFR,
        'IFR',
        CATEGORY_DOTS.IFR,
        'LIFR',
        CATEGORY_DOTS.LIFR,
        '#94a3b8',
      ],
      'circle-stroke-color': mode === 'dark' ? DARK_PAPER : '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': visible ? 0.92 : 0,
      'circle-opacity-transition': { duration: 280, delay: 0 },
      'circle-stroke-opacity': visible ? 0.95 : 0,
      'circle-stroke-opacity-transition': { duration: 280, delay: 0 },
    },
  })
}

function showStations(map: MapLibreMap, visible: boolean): void {
  if (map.getLayer('viewport-stations-dots') === undefined) return
  map.setPaintProperty(
    'viewport-stations-dots',
    'circle-opacity',
    visible ? 0.92 : 0,
  )
  map.setPaintProperty(
    'viewport-stations-dots',
    'circle-stroke-opacity',
    visible ? 0.95 : 0,
  )
}

function addMarkers(map: MapLibreMap): void {
  map.addSource('area-window', {
    type: 'geojson',
    data: emptyCollection(),
  })
  map.addLayer({
    id: 'area-fill',
    type: 'fill',
    source: 'area-window',
    paint: { 'fill-color': SELECTION_INK, 'fill-opacity': 0.06 },
  })
  map.addLayer({
    id: 'area-ring',
    type: 'line',
    source: 'area-window',
    paint: {
      'line-color': SELECTION_INK,
      'line-width': 1.2,
      'line-opacity': 0.7,
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
      'circle-stroke-color': DARK_PAPER,
      'circle-stroke-width': 1.5,
    },
  })

  map.addSource('area-stations', { type: 'geojson', data: emptyCollection() })
  map.addLayer({
    id: 'area-stations-halo',
    type: 'circle',
    source: 'area-stations',
    paint: {
      'circle-radius': 11,
      'circle-color': DARK_PAPER,
      'circle-opacity': 0.45,
      'circle-blur': 1,
    },
  })
  map.addLayer({
    id: 'area-stations',
    type: 'circle',
    source: 'area-stations',
    paint: {
      'circle-radius': 6,
      'circle-color': '#eef3f4',
      'circle-stroke-color': DARK_PAPER,
      'circle-stroke-width': 2,
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
      'circle-radius': 8,
      'circle-color': SELECTION_INK,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
    },
  })
}

function showAdvisories(map: MapLibreMap, visible: boolean): void {
  if (map.getLayer('advisories-fill') !== undefined) {
    map.setPaintProperty('advisories-fill', 'fill-opacity', visible ? 0.75 : 0)
  }
  if (map.getLayer('advisories-outline') !== undefined) {
    map.setPaintProperty(
      'advisories-outline',
      'line-opacity',
      visible ? 0.9 : 0,
    )
  }
}

function addAdvisoryLayers(
  map: MapLibreMap,
  data: IslandLayers,
  visible: boolean,
): void {
  if (!map.hasImage('advisory-hatch')) {
    map.addImage('advisory-hatch', hatchPattern(), { pixelRatio: 1 })
  }
  map.addSource('advisories', {
    type: 'geojson',
    data: advisoriesOf(data),
  })
  map.addLayer({
    id: 'advisories-fill',
    type: 'fill',
    source: 'advisories',
    paint: {
      'fill-pattern': 'advisory-hatch',
      'fill-opacity': visible ? 0.75 : 0,
      'fill-opacity-transition': { duration: 260, delay: 0 },
    },
  })
  map.addLayer({
    id: 'advisories-outline',
    type: 'line',
    source: 'advisories',
    paint: {
      'line-color': HAZARD_INK,
      'line-width': 1,
      'line-opacity': visible ? 0.9 : 0,
      'line-opacity-transition': { duration: 260, delay: 0 },
    },
  })
}

async function fetchViewportLayers(
  map: MapLibreMap,
): Promise<IslandLayers | null> {
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
    if (!response.ok) return null
    let payload = (await response.json()) as { data?: MapLayers }
    if (!payload.data) return null
    return islandLayers(payload.data)
  } catch {
    return null
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

function warmSuggested(stations: ResolveSuggestion[]): void {
  if (!weatherLayers.rain) return
  for (let station of stationsToWarm(
    stations,
    session.selected?.icao ?? null,
  )) {
    prefetchRadarWindow(station.lat, station.lon, AREA_NM)
  }
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
        name: station.name,
        category: station.category ?? '',
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
        severity: advisory.severity,
        base_ft: advisory.base_ft,
        top_ft: advisory.top_ft,
        due_to: advisory.due_to,
        valid_to: advisory.valid_to,
      },
    })),
  }
}

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
  '& .maplibregl-ctrl-group': {
    background: 'var(--glass) !important',
    border: '1px solid var(--glass-border) !important',
    borderRadius: '14px !important',
    overflow: 'hidden',
    boxShadow: 'var(--shadow) !important',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
  },
  '& .maplibregl-ctrl-group button': {
    background: 'transparent !important',
    filter: 'var(--ctrl-filter)',
  },
  '& .maplibregl-ctrl-group button + button': {
    borderBlockStart: '1px solid var(--glass-border)',
  },
  '& .maplibregl-ctrl-attrib.maplibregl-compact': {
    background: 'var(--glass) !important',
    color: 'var(--ink-3) !important',
    borderRadius: '10px',
    backdropFilter: 'blur(10px)',
    WebkitBackdropFilter: 'blur(10px)',
  },
  '& .maplibregl-ctrl-attrib.maplibregl-compact-show': {
    background: 'var(--glass-strong) !important',
  },
  '& .maplibregl-ctrl-attrib a': { color: 'var(--ink-2) !important' },
  '& .maplibregl-ctrl-attrib-button': {
    backgroundColor: 'transparent !important',
    filter: 'var(--ctrl-filter)',
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
