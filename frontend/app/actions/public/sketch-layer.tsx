import roughjs from 'roughjs'
import type { RoughSVG } from 'roughjs/bin/svg.js'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type { BundleWind } from '#app/lib/api-types.ts'
import {
  AREA_NM,
  type RadarWindow,
  fetchRadarWindow,
  humidityPercent,
} from '#app/lib/radar.ts'
import type { SelectedStation } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'
import { weatherLayers } from '#app/ui/public/weather-layers.ts'
import {
  type WeatherGrid,
  fetchWeatherGrid,
  sampleGrid,
} from '#app/lib/weather-grid.ts'

/**
 * roughjs ships a default export, but NodeNext resolves the CJS typings to
 * the module namespace, so the shape is declared here once.
 */
const rough = roughjs as unknown as {
  svg: (node: SVGSVGElement) => RoughSVG
}

const SVG_NS = 'http://www.w3.org/2000/svg'
const FADE_ID = 'area-fade'
const MASK_ID = 'area-mask'
const BLOOM_ID = 'area-bloom'

/** Sixteen points, so "wind from the south-southeast" is a lookup. */
const COMPASS = [
  'north',
  'north-northeast',
  'northeast',
  'east-northeast',
  'east',
  'east-southeast',
  'southeast',
  'south-southeast',
  'south',
  'south-southwest',
  'southwest',
  'west-southwest',
  'west',
  'west-northwest',
  'northwest',
  'north-northwest',
]

/**
 * Weather inside a real area around the station: 20 nm at map scale. The
 * boundary is only a sampling limit, so nothing is drawn for it; the fields
 * fade out where the data ends.
 */
export const SketchLayer = clientEntry(
  import.meta.url,
  function SketchLayer(handle: Handle) {
    let host: HTMLElement | undefined
    let svg: SVGSVGElement | undefined
    let label: HTMLElement | undefined
    let frame = 0
    let radar: RadarWindow | null = null
    let radarFor: string | null = null
    let radarAbort: AbortController | null = null
    let grid: WeatherGrid | null = null
    let gridFor: string | null = null
    let gridAbort: AbortController | null = null
    let built: {
      key: string
      x: number
      y: number
      group: SVGGElement
    } | null = null

    function schedule(): void {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        draw()
      })
    }

    function loadRadar(station: SelectedStation): void {
      if (station.lat === null || station.lon === null) return
      if (radarFor === station.icao) return

      radarFor = station.icao
      radar = null
      radarAbort?.abort()
      let controller = new AbortController()
      radarAbort = controller
      void fetchRadarWindow(
        station.lat,
        station.lon,
        AREA_NM,
        controller.signal,
      ).then((result) => {
        if (controller.signal.aborted) return
        radar = result
        schedule()
      })
    }

    function loadGrid(station: SelectedStation): void {
      if (station.lat === null || station.lon === null) return
      if (gridFor === station.icao) return

      gridFor = station.icao
      grid = null
      gridAbort?.abort()
      let controller = new AbortController()
      gridAbort = controller
      void fetchWeatherGrid(
        station.lat,
        station.lon,
        AREA_NM,
        controller.signal,
      ).then((result) => {
        if (controller.signal.aborted) return
        grid = result
        schedule()
      })
    }

    function draw(): void {
      if (host === undefined || svg === undefined || label === undefined) return

      let station = session.selected
      let anchor = session.anchor
      if (station === null || station.facts === null || anchor === null) {
        radarAbort?.abort()
        radarFor = null
        radar = null
        gridAbort?.abort()
        gridFor = null
        grid = null
        built = null
        svg.replaceChildren()
        label.style.display = 'none'
        return
      }

      let rainOn = weatherLayers.rain
      let tempOn = weatherLayers.temp

      if (rainOn) loadRadar(station)
      loadGrid(station)

      let facts = station.facts
      let { x, y, pxPerNm } = anchor
      let radius = AREA_NM * pxPerNm
      let ink = temperatureColor(facts.temperature?.c ?? null)
      let seed = seedOf(station.icao)
      let panel = document.querySelector<HTMLElement>(
        '[aria-label="Answer"][data-open="true"]',
      )
      let limit = host.clientWidth - (panel?.offsetWidth ?? 0) - 16
      let key = [
        station.icao,
        radius.toFixed(1),
        rainOn,
        tempOn,
        grid === null ? 0 : 1,
        radar === null ? 0 : 1,
      ].join('|')

      // A pan only moves the drawing; rebuilding every rough arrow for it
      // costs far more than translating the group. Rebuild on zoom, layer or
      // data changes, and slide otherwise.
      if (built !== null && built.key === key) {
        built.group.setAttribute(
          'transform',
          `translate(${(x - built.x).toFixed(2)} ${(y - built.y).toFixed(2)})`,
        )
      } else {
        let group = document.createElementNS(SVG_NS, 'g')
        let rc = rough.svg(svg)
        group.append(tempDefs(x, y, radius, ink))
        let field = document.createElementNS(SVG_NS, 'g')
        field.setAttribute('mask', `url(#${MASK_ID})`)

        // A soft warmth bloom, so the area carries the temperature even where
        // there is no echo.
        if (tempOn) {
          let bloom = document.createElementNS(SVG_NS, 'circle')
          bloom.setAttribute('cx', String(x))
          bloom.setAttribute('cy', String(y))
          bloom.setAttribute('r', String(radius))
          bloom.setAttribute('fill', `url(#${BLOOM_ID})`)
          field.append(bloom)
        }

        if (rainOn && radar !== null) {
          let image = document.createElementNS(SVG_NS, 'image')
          image.setAttribute('href', radar.image)
          image.setAttribute('x', String(x - radius))
          image.setAttribute('y', String(y - radius))
          image.setAttribute('width', String(radius * 2))
          image.setAttribute('height', String(radius * 2))
          image.setAttribute('preserveAspectRatio', 'none')
          image.setAttribute('opacity', '0.7')
          field.append(image)
        }

        group.append(field)

        let wind = document.createElementNS(SVG_NS, 'g')
        wind.setAttribute('opacity', '0.85')
        wind.setAttribute('mask', `url(#${MASK_ID})`)
        wind.append(
          ...windField(
            rc,
            x,
            y,
            radius,
            grid,
            facts.wind,
            tempOn ? ink : '#cfcfc9',
            seed,
            tempOn,
          ),
        )
        group.append(wind)
        svg.replaceChildren(group)
        built = { key, x, y, group }
      }

      let humidity = humidityPercent(facts.temperature)
      let lines = [
        `${station.icao} · ${station.category ?? 'no category'}`,
        `wind ${windWords(facts.wind)} · ${temperatureWords(
          facts.temperature?.c ?? null,
        )}`,
        `humidity ${humidity === null ? 'not reported' : `${humidity}%`}${
          rainOn && radar !== null
            ? ` · radar ${Math.round(radar.total * 100)}%`
            : ''
        }`,
      ]

      label.style.display = 'block'
      label.style.left = `${Math.min(
        Math.max(12, x - 150),
        Math.max(12, limit - 320),
      )}px`
      label.style.top = `${Math.min(
        y + 110,
        host.clientHeight - lines.length * 18 - 20,
      )}px`
      label.textContent = lines.join('\n')
    }

    handle.queueTask(() => {
      let unsubscribe = session.onAnchor(schedule)
      session.addEventListener('change', schedule, { signal: handle.signal })
      weatherLayers.addEventListener('change', schedule, {
        signal: handle.signal,
      })
      window.addEventListener('resize', schedule, { signal: handle.signal })
      handle.signal.addEventListener(
        'abort',
        () => {
          cancelAnimationFrame(frame)
          radarAbort?.abort()
          gridAbort?.abort()
          unsubscribe()
        },
        { once: true },
      )
      schedule()
    })

    return () => (
      <div mix={[overlayStyle, ref((node) => (host = node))]}>
        <svg aria-hidden="true" mix={[svgStyle, ref((node) => (svg = node))]} />
        <div
          aria-hidden="true"
          mix={[labelStyle, ref((node) => (label = node))]}
        />
      </div>
    )
  },
)

/** The fade, the mask and the bloom are rebuilt each draw, at the same ids. */
function tempDefs(
  x: number,
  y: number,
  radius: number,
  ink: string,
): SVGElement {
  let defs = document.createElementNS(SVG_NS, 'defs')

  let fade = document.createElementNS(SVG_NS, 'radialGradient')
  fade.setAttribute('id', FADE_ID)
  fade.append(stop('70%', '#ffffff', '1'), stop('100%', '#ffffff', '0'))

  let mask = document.createElementNS(SVG_NS, 'mask')
  mask.setAttribute('id', MASK_ID)
  let disc = document.createElementNS(SVG_NS, 'circle')
  disc.setAttribute('cx', String(x))
  disc.setAttribute('cy', String(y))
  disc.setAttribute('r', String(radius))
  disc.setAttribute('fill', `url(#${FADE_ID})`)
  mask.append(disc)

  let bloom = document.createElementNS(SVG_NS, 'radialGradient')
  bloom.setAttribute('id', BLOOM_ID)
  bloom.append(stop('0%', ink, '0.24'), stop('100%', ink, '0'))

  defs.append(fade, mask, bloom)
  return defs
}

function stop(offset: string, color: string, opacity: string): SVGElement {
  let node = document.createElementNS(SVG_NS, 'stop')
  node.setAttribute('offset', offset)
  node.setAttribute('stop-color', color)
  node.setAttribute('stop-opacity', opacity)
  return node
}

/**
 * A field of strokes across the area. Direction, speed and color come from
 * the RRFS grid, so the wind bends across the area instead of pointing one
 * way; without the grid it falls back to the station's own reading.
 */
function windField(
  rc: RoughSVG,
  x: number,
  y: number,
  radius: number,
  grid: WeatherGrid | null,
  stationWind: BundleWind | null,
  ink: string,
  seed: number,
  colorByTemp: boolean,
): SVGElement[] {
  let fallback =
    stationWind !== null &&
    !stationWind.is_calm &&
    stationWind.direction_deg !== null
      ? (() => {
          let flow = ((stationWind.direction_deg! + 180) * Math.PI) / 180
          return {
            ux: Math.sin(flow),
            uy: -Math.cos(flow),
            speed: stationWind.speed_kt ?? 0,
            color: ink,
          }
        })()
      : null

  if (grid === null && fallback === null) return []

  let step = Math.min(64, Math.max(26, radius / 7))
  let inner = radius * 0.94
  let nodes: SVGElement[] = []

  for (let gy = -inner; gy <= inner; gy += step) {
    for (let gx = -inner; gx <= inner; gx += step) {
      let wobbleX = ((seed + gx * 7 + gy * 13) % 11) - 5
      let wobbleY = ((seed + gx * 11 + gy * 5) % 11) - 5
      let px = x + gx + wobbleX
      let py = y + gy + wobbleY
      if ((px - x) ** 2 + (py - y) ** 2 > inner * inner) continue

      let ux = 0
      let uy = 0
      let speed = 0
      let color = ink

      if (grid !== null) {
        let sample = sampleGrid(grid, (px - x) / radius, -(py - y) / radius)
        if (sample === null) continue
        let magnitude = Math.hypot(sample.u, sample.v)
        if (magnitude < 0.5) continue
        ux = sample.u / magnitude
        uy = -sample.v / magnitude
        speed = magnitude
        color = colorByTemp ? temperatureColor(sample.temperature) : ink
      } else if (fallback !== null) {
        ux = fallback.ux
        uy = fallback.uy
        speed = fallback.speed
        color = fallback.color
      }

      let length = Math.min(30, 12 + speed * 0.8)
      let tipX = px + (ux * length) / 2
      let tipY = py + (uy * length) / 2
      let options = {
        roughness: 0.7,
        stroke: color,
        strokeWidth: 1.8,
        seed,
      } as const
      let head = (turn: number): [number, number] => {
        let cos = Math.cos(turn)
        let sin = Math.sin(turn)
        return [
          tipX - (ux * cos - uy * sin) * 4.5,
          tipY - (ux * sin + uy * cos) * 4.5,
        ]
      }

      let arrow = document.createElementNS(SVG_NS, 'g')
      arrow.setAttribute('class', 'rmx-wind-arrow')
      let travel = Math.max(step, 34)
      let duration = Math.max(1.2, travel / (12 + speed * 1.6))
      let delay = (((seed + gx * 3 + gy * 5) % 100) / 100) * duration
      arrow.setAttribute(
        'style',
        `--wind-x:${(ux * travel).toFixed(1)}px;--wind-y:${(uy * travel).toFixed(1)}px;animation-duration:${duration.toFixed(2)}s;animation-delay:-${delay.toFixed(2)}s`,
      )
      arrow.append(
        rc.line(
          px - (ux * length) / 2,
          py - (uy * length) / 2,
          tipX,
          tipY,
          options,
        ),
        rc.line(tipX, tipY, ...head(0.5), options),
        rc.line(tipX, tipY, ...head(-0.5), options),
      )
      nodes.push(arrow)
    }
  }

  return nodes
}

function seedOf(icao: string): number {
  let seed = 7
  for (let index = 0; index < icao.length; index++) {
    seed = (seed * 31 + icao.charCodeAt(index)) % 100000
  }
  return seed
}

/** Warmth as color: cold blue through green and amber to hot red. */
function temperatureColor(celsius: number | null): string {
  if (celsius === null) return '#b3a678'
  if (celsius <= 0) return '#5f8fb8'
  if (celsius < 10) return '#6f9f9a'
  if (celsius < 20) return '#a8b071'
  if (celsius < 30) return '#d09a4e'
  return '#c4643f'
}

function temperatureWords(celsius: number | null): string {
  if (celsius === null) return 'temperature not reported'
  return `${Math.round(celsius)} °C`
}

function windWords(wind: BundleWind | null): string {
  if (wind === null) return 'not reported'
  if (wind.is_calm) return 'calm'
  if (wind.is_variable || wind.direction_deg === null) {
    return `variable at ${wind.speed_kt} kt`
  }
  let point = COMPASS[Math.round(wind.direction_deg / 22.5) % 16]
  return `from the ${point} at ${wind.speed_kt} kt`
}

const overlayStyle = css({
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  pointerEvents: 'none',
  overflow: 'hidden',
})

const svgStyle = css({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
})

const labelStyle = css({
  position: 'absolute',
  display: 'none',
  padding: '5px 9px',
  border: '1px solid var(--glass-border)',
  borderRadius: '8px',
  background: 'rgba(9, 9, 10, 0.72)',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-0)',
  whiteSpace: 'pre',
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
})
