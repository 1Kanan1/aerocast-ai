import roughjs from 'roughjs'
import type { RoughSVG } from 'roughjs/bin/svg.js'
import type { Handle } from 'remix/component'
import { clientEntry, css, ref } from 'remix/component'

import type { BundleWind } from '#app/lib/api-types.ts'
import {
  AREA_NM,
  RAIN_FALL,
  type RadarDrop,
  type RadarWindow,
  fetchRadarWindow,
} from '#app/lib/radar.ts'
import {
  type FieldStation,
  areaFieldStations,
  screenOffset,
} from '#app/lib/public/field-stations.ts'
import type { Anchor } from '#app/ui/public/session.ts'
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
const CLIP_ID = 'area-clip'
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
/** The longest an arrow drifts, so the canvas can be sized for it. */
const WIND_TRAVEL = 90
/** The furthest the arrows reach past their origin, on top of the drift. */
const WIND_STROKE = 24
/** Per echo level: streak length, width, fall speed and solidity. */
const RAIN_LENGTH = [4.5, 7, 10, 13]
const RAIN_WIDTHS = [0.6, 0.85, 1.1, 1.3]
const RAIN_SPEED = [16, 34, 58, 86]
const RAIN_ALPHA = [0.32, 0.55, 0.75, 0.9]
/** The furthest a drop falls on screen, however large the field is. */
const RAIN_TRAVEL = 20
/**
 * Rain is one pale colour, not a ramp. The echo already reads through its
 * density and length, and the colour channel belongs to the arrows: a field
 * with two coloured mark types is two fields.
 */
const RAIN_COLOR = '#dbeaf3'
/**
 * How far the carried field may drift from the scale it was built at before
 * it is rebuilt. Ten percent is under the point where the echo reads as
 * magnified rather than drawn.
 */
const SCALE_DRIFT = 0.1
/** Arrow shapes, shared by every field and every rebuild. Bounded by the ramp. */
const ARROW_SHAPES = new Map<string, Path2D>()
const ARROW_SHAPE_LIMIT = 4096

/** A station's own weather, fetched once and kept while the station is in view. */
interface StationField {
  grid: WeatherGrid | null
  radar: RadarWindow | null
  gridRequested: boolean
  radarRequested: boolean
  abort: AbortController
}

interface FieldFrame {
  lat: number
  lon: number
  /** The circle every field is cut to. */
  radiusNm: number
  /** Only a lone station gets a glow; several stacked glows read as one disc. */
  glow: boolean
  stations: FieldStation[]
}

/**
 * Each station in the open area draws its own weather the way the station
 * view does: a field 30 nm across around the station, with its own wind,
 * warmth and echo. The area's circle cuts every field at its edge. With a
 * station selected, the frame is that station's own field.
 */
export const SketchLayer = clientEntry(
  import.meta.url,
  function SketchLayer(handle: Handle) {
    let host: HTMLElement | undefined
    let carrier: HTMLElement | undefined
    let svg: SVGSVGElement | undefined
    let frame = 0
    let stationFields = new Map<string, StationField>()
    let built: {
      key: string
      x: number
      y: number
      pxPerNm: number
    } | null = null
    /** True from the first frame of a gesture until the camera settles. */
    let moving = false
    /** The clip and the station layer, created once and reused by rebuilds. */
    let stationDefs: SVGDefsElement | undefined
    let layer: SVGGElement | undefined
    let clip: SVGCircleElement | undefined
    /** One station's nodes, kept across rebuilds so its echo is not decoded again. */
    let stationNodes = new Map<string, StationNode>()
    let windCanvas: HTMLCanvasElement | undefined
    let windContext: CanvasRenderingContext2D | null = null
    let windScale = 1
    let windCentre = 0
    let windRadius = 0
    let windArrows: WindArrow[] = []
    let rainStreaks: RainStreak[] = []
    let windFrame = 0

    function schedule(): void {
      if (frame !== 0) return
      frame = requestAnimationFrame(() => {
        frame = 0
        draw()
      })
    }

    /** Start a station's fetches once; they stay cached while it is in view. */
    function loadField(station: FieldStation, rainOn: boolean): StationField {
      let field: StationField = stationFields.get(station.icao) ?? {
        grid: null,
        radar: null,
        gridRequested: false,
        radarRequested: false,
        abort: new AbortController(),
      }
      stationFields.set(station.icao, field)

      let { signal } = field.abort
      if (!field.gridRequested) {
        field.gridRequested = true
        void fetchWeatherGrid(station.lat, station.lon, AREA_NM, signal).then(
          (result) => {
            if (signal.aborted) return
            field.grid = result
            schedule()
          },
        )
      }
      if (rainOn && !field.radarRequested) {
        field.radarRequested = true
        void fetchRadarWindow(station.lat, station.lon, AREA_NM, signal).then(
          (result) => {
            if (signal.aborted) return
            field.radar = result
            schedule()
          },
        )
      }
      return field
    }

    /** Stop fetching for, and forget, every station not in the keep set. */
    function keepFields(keep: Set<string>): void {
      for (let [icao, field] of stationFields) {
        if (keep.has(icao)) continue
        field.abort.abort()
        stationFields.delete(icao)
      }
    }

    function stopWind(): void {
      if (windFrame !== 0) window.clearTimeout(windFrame)
      windFrame = 0
    }

    /** Redraw the field, but not on every frame the screen offers. */
    function flowWind(): void {
      if (windFrame !== 0) return
      windFrame = window.setTimeout(() => {
        windFrame = 0
        renderField(performance.now())
        flowWind()
      }, WIND_FRAME_MS)
    }

    /**
     * Start the drift again after a gesture, or after a build. Nothing to do
     * while the map moves: the field is being carried by a transform then, so
     * redrawing the rain and arrows would be work about to be scaled.
     */
    function resumeWind(): void {
      if (moving || (windArrows.length === 0 && rainStreaks.length === 0))
        return
      if (windCanvas === undefined || windCanvas.style.display === 'none')
        return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      flowWind()
    }

    /**
     * One pass over the field: rain first, then the arrows over it. A drop
     * falls along its own line, fading in and out at the ends of its loop;
     * an arrow drifts along its flow vector. Both thin towards the edge of
     * their station's field, and the canvas is clipped to the area's circle,
     * so nothing is painted outside it.
     */
    function renderField(now: number, at?: number): void {
      let canvas = windCanvas
      let context = windContext
      if (canvas === undefined || context === null) return

      let scale = windScale
      context.setTransform(1, 0, 0, 1, 0, 0)
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.save()
      context.setTransform(scale, 0, 0, scale, 0, 0)
      context.beginPath()
      context.arc(windCentre, windCentre, windRadius, 0, Math.PI * 2)
      context.clip()
      context.lineCap = 'round'

      for (let streak of rainStreaks) {
        let phase =
          at ?? (((now / 1000 / streak.duration + streak.phase) % 1) + 1) % 1
        let alpha =
          streak.edge * streak.alpha * (0.15 + 0.85 * Math.sin(Math.PI * phase))
        if (alpha < 0.02) continue

        let head = phase * streak.travel
        context.globalAlpha = alpha
        context.strokeStyle = streak.color
        context.lineWidth = streak.width
        context.beginPath()
        context.moveTo(
          streak.x + streak.ux * (head - streak.length),
          streak.y + streak.uy * (head - streak.length),
        )
        context.lineTo(streak.x + streak.ux * head, streak.y + streak.uy * head)
        context.stroke()
      }

      context.lineWidth = 1.8

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

      context.restore()
    }

    function paintField(
      x: number,
      y: number,
      frameRadius: number,
      reach: number,
      arrows: WindArrow[],
      rain: RainStreak[],
    ): void {
      windArrows = arrows
      rainStreaks = rain
      stopWind()
      if (windCanvas === undefined) return

      if (arrows.length === 0 && rain.length === 0) {
        windCanvas.style.display = 'none'
        return
      }

      let half = frameRadius + reach
      let size = half * 2
      let density = Math.min(window.devicePixelRatio || 1, 2)
      let scale = Math.max(0.75, Math.min(density, WIND_MAX_PIXELS / size))

      windCanvas.style.display = 'block'
      windCanvas.style.left = `${x - half}px`
      windCanvas.style.top = `${y - half}px`
      windCanvas.style.width = `${size}px`
      windCanvas.style.height = `${size}px`
      windCanvas.width = Math.round(size * scale)
      windCanvas.height = Math.round(size * scale)
      windScale = scale
      windCentre = half
      windRadius = frameRadius
      windContext = windCanvas.getContext('2d')

      renderField(performance.now(), 0.5)
      resumeWind()
    }

    /** The stations whose fields are drawn, and the circle they are cut to. */
    function frameSource(): FieldFrame | null {
      let station = session.selected
      if (
        station !== null &&
        station.facts !== null &&
        station.lat !== null &&
        station.lon !== null
      ) {
        return {
          lat: station.lat,
          lon: station.lon,
          radiusNm: AREA_NM,
          glow: true,
          stations: [
            {
              icao: station.icao,
              lat: station.lat,
              lon: station.lon,
              temperature: station.facts.temperature?.c ?? null,
              wind: station.facts.wind,
            },
          ],
        }
      }

      let area = session.area
      let payload = session.areaPayload
      if (area === null || payload === null) return null

      return {
        lat: area.lat,
        lon: area.lon,
        radiusNm: payload.radius_nm,
        glow: false,
        stations: areaFieldStations(payload),
      }
    }

    /**
     * Put the built drawing where the camera now is. The drawing keeps the
     * coordinates it was built at; an inner layer carries the pan, the turn
     * and the zoom as one transform, so moving the map costs a style write
     * and a composited layer rather than a rebuild.
     *
     * The transform sits on the inner layer, not on the clipping box: a
     * transformed box carries its own clip with it, which would leave part of
     * the screen bare as soon as the field is panned off centre.
     */
    function place(anchor: Anchor | null): void {
      if (carrier === undefined) return
      if (anchor === null || built === null) {
        carrier.style.transform = ''
        return
      }

      let scale = anchor.pxPerNm / built.pxPerNm
      carrier.style.transformOrigin = `${built.x}px ${built.y}px`
      carrier.style.transform =
        `translate(${(anchor.x - built.x).toFixed(2)}px, ${(anchor.y - built.y).toFixed(2)}px) ` +
        `rotate(${anchor.bearing.toFixed(2)}deg) scale(${scale.toFixed(4)})`
    }

    function draw(): void {
      if (host === undefined || svg === undefined) return

      let source = frameSource()
      let anchor = session.anchor
      if (source === null || anchor === null) {
        keepFields(new Set())
        clearDrawing()
        return
      }

      let rainOn = weatherLayers.rain
      let tempOn = weatherLayers.temp
      let windOn = weatherLayers.wind

      // The field is measured now: radar and model wind say nothing about an
      // hour the timeline is reading, so they step aside for it.
      if (session.viewHour !== 0) {
        clearDrawing()
        return
      }

      keepFields(new Set(source.stations.map((station) => station.icao)))
      let fields = source.stations.map((station) => ({
        station,
        field: loadField(station, rainOn),
      }))

      let picked =
        session.selected === null
          ? null
          : (stationFields.get(session.selected.icao)?.radar ?? null)
      session.setEchoShare(rainOn && picked !== null ? picked.total : null)

      let { x, y, pxPerNm } = anchor
      let frameRadius = source.radiusNm * pxPerNm
      let fieldRadius = AREA_NM * pxPerNm
      let step = windStep(fieldRadius, source.stations.length)
      let reach = step + WIND_STROKE
      let key = [
        source.lat.toFixed(4),
        source.lon.toFixed(4),
        source.radiusNm,
        source.glow,
        rainOn,
        tempOn,
        windOn,
        fields
          .map(({ station, field }) =>
            [
              station.icao,
              station.temperature,
              field.grid === null ? 0 : 1,
              field.radar === null ? 0 : 1,
            ].join(':'),
          )
          .join(';'),
      ].join('|')

      // Only what the drawing is made of rebuilds it. Where the camera is
      // does not: `place` carries the built drawing instead.
      if (built === null || built.key !== key) {
        let frame = ensureFrame()
        frame.clip.setAttribute('cx', String(x))
        frame.clip.setAttribute('cy', String(y))
        frame.clip.setAttribute('r', String(frameRadius))
        let winds: WindArrow[] = []
        let rain: RainStreak[] = []
        let centre = frameRadius + reach

        for (let { station, field } of fields) {
          let offset = screenOffset(
            source.lat,
            source.lon,
            station.lat,
            station.lon,
            pxPerNm,
          )
          let ink = temperatureColor(station.temperature)
          let node = stationNode(
            station.icao,
            x + offset.x,
            y + offset.y,
            fieldRadius,
            ink,
            tempOn && source.glow,
          )
          frame.layer.append(node.group)
          if (rainOn && field.radar !== null) {
            rain.push(
              ...rainFor(
                offset,
                fieldRadius,
                frameRadius,
                centre,
                field.radar.drops,
              ),
            )
          }
          if (windOn) {
            winds.push(
              ...windArrowsFor(
                offset,
                fieldRadius,
                frameRadius,
                step,
                reach,
                field.grid,
                station.wind,
                tempOn ? ink : '#cfcfc9',
                seedOf(station.icao),
                tempOn,
              ),
            )
          }
        }

        let keep = new Set(fields.map(({ station }) => station.icao))
        for (let [icao, node] of stationNodes) {
          if (keep.has(icao)) continue
          node.group.remove()
          node.defs.remove()
          stationNodes.delete(icao)
        }

        built = { key, x, y, pxPerNm }
        if (windOn || rainOn) {
          paintField(x, y, frameRadius, reach, winds, rain)
        } else {
          stopWind()
          windArrows = []
          rainStreaks = []
          if (windCanvas !== undefined) windCanvas.style.display = 'none'
        }
      }

      place(anchor)
    }

    /** Drop the drawing, and with it every node it was built from. */
    function clearDrawing(): void {
      built = null
      moving = false
      stopWind()
      windArrows = []
      rainStreaks = []
      session.setEchoShare(null)
      if (windCanvas !== undefined) windCanvas.style.display = 'none'
      if (carrier !== undefined) carrier.style.transform = ''
      stationNodes.clear()
      stationDefs = undefined
      layer = undefined
      clip = undefined
      svg?.replaceChildren()
    }

    /** The clip and the station layer, made once and kept across rebuilds. */
    function ensureFrame(): { layer: SVGGElement; clip: SVGCircleElement } {
      if (layer === undefined || clip === undefined) {
        let defs = document.createElementNS(SVG_NS, 'defs')
        let clipping = document.createElementNS(SVG_NS, 'clipPath')
        clipping.setAttribute('id', CLIP_ID)
        let circleNode = circle(0, 0, 0)
        clipping.append(circleNode)
        defs.append(fadeGradient(), clipping)
        stationDefs = defs
        clip = circleNode
        layer = document.createElementNS(SVG_NS, 'g')
        layer.setAttribute('clip-path', `url(#${CLIP_ID})`)
        svg?.replaceChildren(defs, layer)
      }
      return { layer, clip }
    }

    /**
     * One station's field at its place: the warmth bloom, faded before the
     * field's edge. Its rain is drawn on the field canvas, not here.
     */
    function stationNode(
      icao: string,
      x: number,
      y: number,
      radius: number,
      ink: string,
      bloomOn: boolean,
    ): StationNode {
      let node = stationNodes.get(icao)
      if (node === undefined) {
        node = createStationNode(icao)
        stationNodes.set(icao, node)
      }

      node.mask.setAttribute('cx', String(x))
      node.mask.setAttribute('cy', String(y))
      node.mask.setAttribute('r', String(radius))

      node.bloom.setAttribute('cx', String(x))
      node.bloom.setAttribute('cy', String(y))
      node.bloom.setAttribute('r', String(radius))
      node.bloom.setAttribute('display', bloomOn ? 'inline' : 'none')
      node.from.setAttribute('stop-color', ink)
      node.to.setAttribute('stop-color', ink)

      return node
    }

    function createStationNode(icao: string): StationNode {
      let defs = document.createElementNS(SVG_NS, 'defs')

      let maskNode = document.createElementNS(SVG_NS, 'mask')
      maskNode.setAttribute('id', `${MASK_ID}-${icao}`)
      let mask = circle(0, 0, 0, `url(#${FADE_ID})`)
      maskNode.append(mask)

      let bloomGradient = document.createElementNS(SVG_NS, 'radialGradient')
      bloomGradient.setAttribute('id', `${BLOOM_ID}-${icao}`)
      let from = stop('0%', '#ffffff', '0.24')
      let to = stop('100%', '#ffffff', '0')
      bloomGradient.append(from, to)
      defs.append(maskNode, bloomGradient)
      stationDefs?.append(defs)

      let group = document.createElementNS(SVG_NS, 'g')
      group.setAttribute('mask', `url(#${MASK_ID}-${icao})`)
      let bloom = circle(0, 0, 0, `url(#${BLOOM_ID}-${icao})`)
      group.append(bloom)

      return {
        defs,
        group,
        mask,
        bloom,
        from,
        to,
      }
    }

    handle.queueTask(() => {
      // The anchor moves every frame of a pan or a zoom; placing the built
      // drawing is all that costs, and the arrows stop while the field is
      // being carried. A build is scheduled only when there is nothing to
      // place yet, or when the camera settles at a different scale.
      let unsubscribe = session.onAnchor((anchor, gesture) => {
        if (gesture) {
          // A gesture carries the field; the arrows would only be scaled a
          // frame later, so their loop waits for the camera to stop.
          moving = true
          stopWind()
        }
        place(anchor)
        if (built === null) schedule()
      })
      let unsubscribeSettled = session.onAnchorSettled(() => {
        moving = false

        let anchor = session.anchor
        if (built === null || anchor === null) {
          schedule()
          return
        }

        let drift = Math.abs(anchor.pxPerNm / built.pxPerNm - 1)
        if (drift >= SCALE_DRIFT) {
          built = null
          schedule()
          return
        }

        resumeWind()
      })
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
          keepFields(new Set())
          unsubscribe()
          unsubscribeSettled()
        },
        { once: true },
      )
      schedule()
    })

    return () => (
      <div mix={[overlayStyle, ref((node) => (host = node))]}>
        <div mix={[carryStyle, ref((node) => (carrier = node))]}>
          <svg
            aria-hidden="true"
            mix={[svgStyle, ref((node) => (svg = node))]}
          />
          <canvas
            aria-hidden="true"
            mix={[windStyle, ref((node) => (windCanvas = node))]}
          />
        </div>
      </div>
    )
  },
)

/** The fade every field's mask uses: solid inside 70% of its radius, clear at the edge. */
function fadeGradient(): SVGElement {
  let fade = document.createElementNS(SVG_NS, 'radialGradient')
  fade.setAttribute('id', FADE_ID)
  fade.append(stop('70%', '#ffffff', '1'), stop('100%', '#ffffff', '0'))
  return fade
}

/**
 * One station's nodes. The group and its defs stay in the document between
 * rebuilds, so a settled zoom moves the same paths instead of building them
 * again.
 */
interface StationNode {
  defs: SVGElement
  group: SVGGElement
  mask: SVGCircleElement
  bloom: SVGCircleElement
  /** The warmth bloom's gradient stops, recolored when the temperature moves. */
  from: SVGStopElement
  to: SVGStopElement
}

/**
 * One drop as the field canvas draws it: a short streak that falls along its
 * own line, fading in and out as it goes, with the same edge fade the arrows
 * have.
 */
interface RainStreak {
  /** Where it sits when its loop starts, in canvas pixels. */
  x: number
  y: number
  ux: number
  uy: number
  length: number
  width: number
  /** Pixels the drop falls over one loop. */
  travel: number
  /** One loop, in seconds. */
  duration: number
  /** Where in the loop it starts, 0 to 1. */
  phase: number
  color: string
  /** How solid it draws, set by its echo level. */
  alpha: number
  edge: number
}

/** The rain of one station, placed relative to the area's centre. */
function rainFor(
  offset: { x: number; y: number },
  fieldRadius: number,
  frameRadius: number,
  centre: number,
  drops: RadarDrop[],
): RainStreak[] {
  let ux = RAIN_FALL.ux
  let uy = RAIN_FALL.uy
  let rain: RainStreak[] = []

  for (let drop of drops) {
    // Only the part of the field inside the circle is worth drawing.
    let x = offset.x + drop.x * fieldRadius
    let y = offset.y + drop.y * fieldRadius
    if (Math.hypot(x, y) > frameRadius + 4) continue

    let away = Math.hypot(drop.x, drop.y)
    let fade = away <= WIND_EDGE ? 1 : Math.max(0, (1 - away) / (1 - WIND_EDGE))
    if (fade === 0) continue

    let travel = Math.min(RAIN_TRAVEL, drop.travel * fieldRadius)
    let level = drop.level

    rain.push({
      x: centre + x,
      y: centre + y,
      ux,
      uy,
      length: RAIN_LENGTH[level],
      width: RAIN_WIDTHS[level],
      // A drop falls only as far as its own echo reaches, so a colour never
      // drifts into a cluster of another colour.
      travel,
      // Heavy echo falls fast and light echo drifts; the level sets the speed
      // and a little scatter keeps a cluster from pulsing in unison.
      duration: Math.max(
        0.18,
        travel / (RAIN_SPEED[level] * (0.92 + 0.16 * drop.phase)),
      ),
      phase: drop.phase,
      color: RAIN_COLOR,
      alpha: RAIN_ALPHA[level],
      edge: 0.8 * fade,
    })
  }

  return rain
}

function circle(
  x: number,
  y: number,
  radius: number,
  fill?: string,
): SVGCircleElement {
  let node = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement
  node.setAttribute('cx', String(x))
  node.setAttribute('cy', String(y))
  node.setAttribute('r', String(radius))
  if (fill !== undefined) node.setAttribute('fill', fill)
  return node
}

function stop(offset: string, color: string, opacity: string): SVGStopElement {
  let node = document.createElementNS(SVG_NS, 'stop') as SVGStopElement
  node.setAttribute('offset', offset)
  node.setAttribute('stop-color', color)
  node.setAttribute('stop-opacity', opacity)
  return node
}

/**
 * The spacing between the arrows of one station's field. One station keeps the
 * density it always had; each extra station in the same circle widens the
 * spacing with the square root of the station count, which holds the total near
 * what a single station draws until the spacing cap. The arrows are redrawn
 * twelve times a second, so their count is the cost.
 */
function windStep(fieldRadius: number, stations: number): number {
  let base = Math.min(64, Math.max(26, fieldRadius / 7))
  return Math.min(170, base * Math.max(1, stations) ** 0.5)
}

/**
 * One arrow's shape, cached. A shape is set by the direction it points and
 * the speed it carries, both of which are the same at every zoom, so the same
 * squiggle serves any rebuild. Roughness is noise: a repeated one is not
 * something the eye picks out of a drifting field, and it keeps the expensive
 * part of a rebuild (three rough lines per arrow) to one run per shape.
 */
function arrowShape(
  ux: number,
  uy: number,
  length: number,
  seed: number,
): Path2D {
  let key = `${seed % 7}:${Math.round(ux * 128)}:${Math.round(uy * 128)}:${Math.round(length)}`
  let cached = ARROW_SHAPES.get(key)
  if (cached !== undefined) return cached

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

  let pen = rough.svg(document.createElementNS(SVG_NS, 'svg'))
  let path = new Path2D()
  for (let stroke of [
    pen.line(-tipX, -tipY, tipX, tipY, options),
    pen.line(tipX, tipY, ...head(0.5), options),
    pen.line(tipX, tipY, ...head(-0.5), options),
  ]) {
    let d = stroke.querySelector('path')?.getAttribute('d')
    if (d !== null && d !== undefined) path.addPath(new Path2D(d))
  }

  if (ARROW_SHAPES.size >= ARROW_SHAPE_LIMIT) ARROW_SHAPES.clear()
  ARROW_SHAPES.set(key, path)
  return path
}

/**
 * A field of strokes across one station's area. Direction, speed and color come from
 * the station's RRFS grid, so the wind bends across the area instead of pointing one
 * way; without the grid it falls back to the station's own reading.
 *
 * `offset` places the station from the area's centre in pixels. Strokes that
 * cannot reach the area's circle are skipped before their shapes are built.
 *
 * The strokes are drawn to a canvas, so each one keeps its shape as a path
 * that is stroked again every frame instead of being rebuilt.
 */
function windArrowsFor(
  offset: { x: number; y: number },
  radius: number,
  frameRadius: number,
  step: number,
  reach: number,
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

  let inner = radius * 0.94
  let travel = Math.max(34, Math.min(step, WIND_TRAVEL))
  let centre = frameRadius + reach
  let arrows: WindArrow[] = []

  for (let gy = -inner; gy <= inner; gy += step) {
    for (let gx = -inner; gx <= inner; gx += step) {
      let wobbleX = ((seed + gx * 7 + gy * 13) % 11) - 5
      let wobbleY = ((seed + gx * 11 + gy * 5) % 11) - 5
      let px = gx + wobbleX
      let py = gy + wobbleY
      let distance = Math.hypot(px, py)
      if (distance > inner) continue
      if (Math.hypot(offset.x + px, offset.y + py) > frameRadius + reach)
        continue

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
      let path = arrowShape(ux, uy, length, seed)

      let duration = Math.max(1.2, travel / (12 + speed * 1.6))
      let fade =
        distance / radius <= WIND_EDGE
          ? 1
          : Math.max(0, (1 - distance / radius) / (1 - WIND_EDGE))

      arrows.push({
        path,
        x: centre + offset.x + px,
        y: centre + offset.y + py,
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
  // The clip belongs to the viewport-sized box; the drawing moves inside it.
  overflow: 'hidden',
})

/** The layer the camera transform rides on: size of the viewport, no clip. */
const carryStyle = css({
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  // One composited layer keeps the move off the main thread.
  willChange: 'transform',
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
