import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import { ceilingFt, visibilitySm } from '../lib/observations.ts'
import { timeLabel } from '../lib/format.ts'

export interface TimelinePoint {
  time: string
  ceiling: number | null
  visibility: number | null
}

export interface TimelineObservation {
  obs_time: string
  decoded: Record<string, unknown>
}

export function timelinePoints(
  observations: TimelineObservation[],
): TimelinePoint[] {
  return [...observations].reverse().map((observation) => ({
    time: observation.obs_time,
    ceiling: ceilingFt(observation.decoded),
    visibility: visibilitySm(observation.decoded),
  }))
}

const WIDTH = 720
const HEIGHT = 200
const LEFT = 46
const RIGHT = 8
const TOP = 18
const PANEL = 58
const GAP = 30
const CEILING_MAX = 12000
const VISIBILITY_MAX = 10

export function Timeline(handle: Handle<{ points: TimelinePoint[] }>) {
  return () => {
    let { points } = handle.props

    if (points.length === 0) {
      return (
        <p mix={emptyStyle}>
          No observations in the last 48 hours, so there is no trend to draw.
        </p>
      )
    }

    let times = points.map((point) => Date.parse(point.time))
    let start = Math.min(...times)
    let end = Math.max(...times)
    let span = end - start
    let width = WIDTH - LEFT - RIGHT

    let x = (time: number) =>
      LEFT + (span === 0 ? width / 2 : ((time - start) / span) * width)

    let ceilingTop = TOP + PANEL
    let visibilityTop = ceilingTop + GAP + PANEL
    let ceilingY = (value: number) =>
      ceilingTop - (Math.min(value, CEILING_MAX) / CEILING_MAX) * PANEL
    let visibilityY = (value: number) =>
      visibilityTop - (Math.min(value, VISIBILITY_MAX) / VISIBILITY_MAX) * PANEL

    return (
      <figure mix={figureStyle}>
        <svg
          aria-label={`Ceiling and visibility from ${timeLabel(points[0].time)} to ${timeLabel(points[points.length - 1].time)}`}
          role="img"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        >
          <text mix={axisTitleStyle} x={LEFT} y={TOP - 6}>
            Ceiling (ft, dashed 1,000 / 3,000)
          </text>
          <text mix={axisTitleStyle} x={LEFT} y={ceilingTop + GAP - 8}>
            Visibility (SM, dashed 3 / 5)
          </text>

          {thresholds(ceilingY, [1000, 3000], LEFT, width)}
          {thresholds(visibilityY, [3, 5], LEFT, width)}

          <path
            d={line(points, times, x, ceilingY, 'ceiling')}
            mix={lineStyle}
          />
          <path
            d={line(points, times, x, visibilityY, 'visibility')}
            mix={lineStyle}
          />

          {points.map((point, index) => (
            <g key={point.time}>
              {point.ceiling === null ? null : (
                <circle
                  cx={x(times[index])}
                  cy={ceilingY(point.ceiling)}
                  mix={dotStyle}
                  r={2}
                />
              )}
              {point.visibility === null ? null : (
                <circle
                  cx={x(times[index])}
                  cy={visibilityY(point.visibility)}
                  mix={dotStyle}
                  r={2}
                />
              )}
            </g>
          ))}

          <line
            mix={axisStyle}
            x1={LEFT}
            x2={LEFT + width}
            y1={ceilingTop}
            y2={ceilingTop}
          />
          <line
            mix={axisStyle}
            x1={LEFT}
            x2={LEFT + width}
            y1={visibilityTop}
            y2={visibilityTop}
          />

          <text mix={tickStyle} x={LEFT - 6} y={TOP + 8}>
            {CEILING_MAX}
          </text>
          <text mix={tickStyle} x={LEFT - 6} y={ceilingTop}>
            0
          </text>
          <text mix={tickStyle} x={LEFT - 6} y={ceilingTop + GAP + 8}>
            {VISIBILITY_MAX}
          </text>
          <text mix={tickStyle} x={LEFT - 6} y={visibilityTop}>
            0
          </text>

          {[0, 1 / 3, 2 / 3, 1].map((fraction) => {
            let time = start + span * fraction
            return (
              <text
                key={fraction}
                mix={tickStyle}
                text-anchor={fraction === 0 ? 'start' : fraction === 1 ? 'end' : 'middle'}
                x={LEFT + width * fraction}
                y={HEIGHT - 4}
              >
                {timeLabel(new Date(time).toISOString()).slice(11, 16)}
              </text>
            )
          })}
        </svg>
        <figcaption mix={captionStyle}>
          {points.length} observations, newest last. Times are UTC.
        </figcaption>
      </figure>
    )
  }
}

function line(
  points: TimelinePoint[],
  times: number[],
  x: (time: number) => number,
  y: (value: number) => number,
  field: 'ceiling' | 'visibility',
): string {
  let path = ''
  let drawing = false

  points.forEach((point, index) => {
    let value = point[field]
    if (value === null) {
      drawing = false
      return
    }
    path += `${drawing ? 'L' : 'M'}${x(times[index]).toFixed(1)} ${y(value).toFixed(1)} `
    drawing = true
  })

  return path.trim()
}

function thresholds(
  y: (value: number) => number,
  values: number[],
  left: number,
  width: number,
) {
  return values.map((value) => (
    <line
      key={value}
      mix={thresholdStyle}
      x1={left}
      x2={left + width}
      y1={y(value)}
      y2={y(value)}
    />
  ))
}

const figureStyle = css({
  margin: 0,
  '& svg': { display: 'block', width: '100%', height: 'auto' },
})

const axisTitleStyle = css({
  fontSize: '9px',
  fill: 'var(--ink-3)',
})

const tickStyle = css({ fontSize: '9px', fill: 'var(--ink-3)' })

const lineStyle = css({
  fill: 'none',
  stroke: 'var(--ink-1)',
  strokeWidth: 1.2,
})

const dotStyle = css({ fill: 'var(--ink-0)' })

const axisStyle = css({ stroke: 'var(--line)', strokeWidth: 1 })

const thresholdStyle = css({
  stroke: 'var(--line)',
  strokeWidth: 1,
  strokeDasharray: '3 3',
})

const captionStyle = css({
  marginBlockStart: '6px',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const emptyStyle = css({ color: 'var(--ink-3)' })
