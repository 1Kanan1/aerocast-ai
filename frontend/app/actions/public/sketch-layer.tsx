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
/**
 * Wind is the only thing on the map that moves all the time, and a full-field
 * repaint at sixty frames a second costs both the processor and the graphics
 * card for no gain in a drifting field. Fifteen frames is enough for drift,
 * and the field is small, so the work stays proportional to it.
 */
const WIND_FRAME_MS = 83
const WIND_MAX_PIXELS = 2048
const WIND_EDGE = 0.7
/** How long the scale must hold still before the field is rebuilt at it. */
const ZOOM_SETTLE_MS = 250

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
      radius: number
      group: SVGGElement
    } | null = null
    let settleTimer = 0
    let windCanvas: HTMLCanvasElement | undefined
    let windContext: CanvasRenderingContext2D | null = null
    let windScale = 1
    let windArrows: WindArrow[] = []
    let windFrame = 0

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

    function stopWind(): void {
      if (windFrame !== 0) window.clearTimeout(windFrame)
      windFrame = 0
    }

    /** Rebuild once, after the zoom stops changing the scale. */
    function settle(): void {
      if (settleTimer !== 0) window.clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        settleTimer = 0
        built = null
        draw()
      }, ZOOM_SETTLE_MS)
    }

    /** Redraw the field, but not on every frame the screen offers. */
    function flowWind(): void {
      windFrame = window.setTimeout(() => {
        windFrame = 0
        renderWind(performance.now())
        flowWind()
      }, WIND_FRAME_MS)
    }

    /**
     * One pass over the arrows: each one drifts along its own flow vector,
     * fades in and out at the ends of its loop, and thins towards the edge of
     * the area where the data stops.
     */
    function renderWind(now: number, at?: number): void {
      let canvas = windCanvas
      let context = windContext
      if (canvas === undefined || context === null) return

      let scale = windScale
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.lineWidth = 1.8
      context.lineCap = 'round'

      for (let arrow of windArrows) {
        let phase =
          at ?? (((now / 1000 / arrow.duration + arrow.phase) % 1) + 1) % 1
        let alpha = arrow.edge * (0.25 + 0.65 * Math.sin(Math.PI * phase))
        if (alpha < 0.02) continue

        context.globalAlpha = alpha
        context.strokeStyle = arrow.color
        context.setTransform(
          scale,
          0,
          0,
          scale,
          (arrow.x + arrow.ux * arrow.travel * phase) * scale,
          (arrow.y + arrow.uy * arrow.travel * phase) * scale,
        )
        context.stroke(arrow.path)
      }

      context.setTransform(1, 0, 0, 1, 0, 0)
      context.globalAlpha = 1
    }

    function paintWind(
      x: number,
      y: number,
      radius: number,
      arrows: WindArrow[],
    ): void {
      windArrows = arrows
      stopWind()
      if (windCanvas === undefined) return

      if (arrows.length === 0) {
        windCanvas.style.display = 'none'
        return
      }

      let size = radius * 2
      let density = Math.min(window.devicePixelRatio || 1, 2)
      let scale = Math.max(0.75, Math.min(density, WIND_MAX_PIXELS / size))

      windCanvas.style.display = 'block'
      windCanvas.style.transform = ''
      windCanvas.style.left = `${x - radius}px`
      windCanvas.style.top = `${y - radius}px`
      windCanvas.style.width = `${size}px`
      windCanvas.style.height = `${size}px`
      windCanvas.width = Math.round(size * scale)
      windCanvas.height = Math.round(size * scale)
      windScale = scale
      windContext = windCanvas.getContext('2d')

      renderWind(performance.now(), 0.5)
      let still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      if (!still) flowWind()
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
        if (settleTimer !== 0) window.clearTimeout(settleTimer)
        settleTimer = 0
        stopWind()
        windArrows = []
        if (windCanvas !== undefined) windCanvas.style.display = 'none'
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
        rainOn,
        tempOn,
        grid === null ? 0 : 1,
        radar === null ? 0 : 1,
      ].join('|')

      // Moving, turning and zooming only change where, at what angle and how
      // big the drawing is, and rebuilding every rough arrow for that costs
      // more than transforming it. The drawing is always built north-up, so
      // one transform at the end carries it; only a change of scale has to end
      // in a rebuild, and that waits until the zoom settles.
      if (built === null || built.key !== key) {
        clearTimeout(settleTimer)
        settleTimer = 0
        let group = document.createElementNS(SVG_NS, 'g')
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
        svg.replaceChildren(group)
        built = { key, x, y, radius, group }
        paintWind(
          x,
          y,
          radius,
          windArrowsFor(
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
      }

      // Carry the drawing to where the camera now puts the station: the same
      // transform whether it was just built or is being carried across a move.
      let scale = radius / built.radius
      let dx = x - built.x
      let dy = y - built.y
      let turn = anchor.bearing
      built.group.setAttribute(
        'transform',
        `translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${turn.toFixed(2)}) scale(${scale.toFixed(4)}) translate(${(-built.x).toFixed(2)} ${(-built.y).toFixed(2)})`,
      )
      if (windCanvas !== undefined) {
        windCanvas.style.transformOrigin = '50% 50%'
        windCanvas.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scale.toFixed(4)}) rotate(${turn.toFixed(2)}deg)`
      }
      if (Math.abs(radius - built.radius) >= 0.5) settle()

      // Only what no other surface says: the station's facts are in the
      // panel, so the field label carries the area's own numbers.
      let humidity = humidityPercent(facts.temperature)
      let echo = rainOn && radar !== null ? Math.round(radar.total * 100) : null
      let lines = [
        `humidity ${humidity === null ? 'not reported' : `${humidity}%`}${
          echo === null ? '' : ` · echo ${echo}%`
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
          stopWind()
          if (settleTimer !== 0) window.clearTimeout(settleTimer)
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
        <canvas
          aria-hidden="true"
          mix={[windStyle, ref((node) => (windCanvas = node))]}
        />
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
 *
 * The strokes are drawn to a canvas, so each one keeps its shape as a path
 * that is stroked again every frame instead of being rebuilt.
 */
function windArrowsFor(
  x: number,
  y: number,
  radius: number,
  grid: WeatherGrid | null,
  stationWind: BundleWind | null,
  ink: string,
  seed: number,
  colorByTemp: boolean,
): WindArrow[] {
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

  let scratch = document.createElementNS(SVG_NS, 'svg')
  let pen = rough.svg(scratch)
  let step = Math.min(64, Math.max(26, radius / 7))
  let inner = radius * 0.94
  let arrows: WindArrow[] = []

  for (let gy = -inner; gy <= inner; gy += step) {
    for (let gx = -inner; gx <= inner; gx += step) {
      let wobbleX = ((seed + gx * 7 + gy * 13) % 11) - 5
      let wobbleY = ((seed + gx * 11 + gy * 5) % 11) - 5
      let px = gx + wobbleX
      let py = gy + wobbleY
      let distance = Math.hypot(px, py)
      if (distance > inner) continue

      let ux = 0
      let uy = 0
      let speed = 0
      let color = ink

      if (grid !== null) {
        let sample = sampleGrid(grid, px / radius, -py / radius)
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
      let tipX = (ux * length) / 2
      let tipY = (uy * length) / 2
      let options = { roughness: 0.7, seed } as const
      let head = (turn: number): [number, number] => {
        let cos = Math.cos(turn)
        let sin = Math.sin(turn)
        return [
          tipX - (ux * cos - uy * sin) * 4.5,
          tipY - (ux * sin + uy * cos) * 4.5,
        ]
      }

      let path = new Path2D()
      for (let stroke of [
        pen.line(-tipX, -tipY, tipX, tipY, options),
        pen.line(tipX, tipY, ...head(0.5), options),
        pen.line(tipX, tipY, ...head(-0.5), options),
      ]) {
        let d = stroke.querySelector('path')?.getAttribute('d')
        if (d !== null && d !== undefined) path.addPath(new Path2D(d))
      }

      let travel = Math.max(step, 34)
      let duration = Math.max(1.2, travel / (12 + speed * 1.6))
      let fade =
        distance / radius <= WIND_EDGE
          ? 1
          : Math.max(0, (1 - distance / radius) / (1 - WIND_EDGE))

      arrows.push({
        path,
        x: px + radius,
        y: py + radius,
        ux,
        uy,
        travel,
        duration,
        phase: ((seed + gx * 3 + gy * 5) % 100) / 100,
        color,
        edge: 0.85 * fade,
      })
    }
  }

  return arrows
}

interface WindArrow {
  /** Shape around its own origin, in the area's pixels. */
  path: Path2D
  x: number
  y: number
  ux: number
  uy: number
  travel: number
  duration: number
  phase: number
  color: string
  edge: number
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

const windStyle = css({
  position: 'absolute',
  display: 'none',
  pointerEvents: 'none',
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
