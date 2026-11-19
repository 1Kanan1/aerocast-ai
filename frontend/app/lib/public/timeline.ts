/**
 * What the timeline reads at an hour: a report behind now, a forecast period
 * ahead. The panel, the rail and the map all read it here, so the words and
 * the drawing cannot describe different hours.
 */

import type {
  BundleMetar,
  BundlePeriod,
  BundleTaf,
} from '#app/lib/api-types.ts'
import { decodedReport } from '#app/lib/observations.ts'

/** How far the timeline reaches in either direction, in hours. */
export const TIMELINE_HOURS = 48

export const HOUR_MS = 60 * 60 * 1000

/** How far a report may sit from an hour and still stand for it. */
export const REPORT_TOLERANCE_MS = HOUR_MS * 1.5

export interface HistoryPoint {
  decoded: Record<string, unknown>
  obs_time: string
  category: string | null
  raw: string
}

export interface TimelineStation {
  facts: BundleMetar | null
  history: HistoryPoint[]
  taf: BundleTaf | null
}

/** What an hour reads as, or why it reads as nothing. */
export type HourConditions =
  | { kind: 'report'; point: HistoryPoint }
  | { kind: 'period'; period: BundlePeriod }
  | { kind: 'no-report' }
  | { kind: 'no-forecast' }

export function conditionsAt(
  station: TimelineStation,
  hour: number,
  base: number,
): HourConditions {
  let target = base + hour * HOUR_MS

  if (hour < 0) {
    let point = nearestReport(station.history, target)
    return point === null ? { kind: 'no-report' } : { kind: 'report', point }
  }

  let period = periodAt(station.taf, target)
  return period === null ? { kind: 'no-forecast' } : { kind: 'period', period }
}

/**
 * The station's own numbers at an hour: the report from that hour, the
 * forecast period for an hour ahead, the live report at now. Null when the
 * hour has neither, so the map can step aside instead of borrowing a number.
 */
export interface HourReading {
  temperature_c: number | null
  wind: {
    direction_deg: number | null
    speed_kt: number | null
    is_calm: boolean
  } | null
}

export function readingAt(
  station: TimelineStation,
  hour: number,
  base: number,
): HourReading | null {
  if (hour === 0) {
    let facts = station.facts
    if (facts === null) return null
    return {
      temperature_c: facts.temperature?.c ?? null,
      wind: facts.wind,
    }
  }

  let conditions = conditionsAt(station, hour, base)
  if (conditions.kind === 'report') {
    let facts = decodedReport(conditions.point.decoded)
    return {
      temperature_c: facts.temperature?.c ?? null,
      wind: facts.wind,
    }
  }
  if (conditions.kind === 'period') {
    let wind = conditions.period.wind
    return {
      temperature_c: null,
      wind:
        wind === null
          ? null
          : {
              direction_deg: wind.direction_deg,
              speed_kt: wind.speed_kt,
              is_calm: (wind.speed_kt ?? 0) === 0,
            },
    }
  }
  return null
}

/** The report closest to an hour, if one is close enough to stand for it. */
export function nearestReport(
  history: HistoryPoint[],
  target: number,
): HistoryPoint | null {
  let best: HistoryPoint | null = null
  let bestGap = Infinity

  for (let point of history) {
    let gap = Math.abs(Date.parse(point.obs_time) - target)
    if (gap < bestGap) {
      best = point
      bestGap = gap
    }
  }

  return bestGap <= REPORT_TOLERANCE_MS ? best : null
}

/** The forecast period covering an hour, latest start first. */
export function periodAt(
  taf: BundleTaf | null,
  target: number,
): BundlePeriod | null {
  if (taf === null) return null

  let covering = taf.periods.filter(
    (period) =>
      Date.parse(period.from) <= target && target <= Date.parse(period.to),
  )
  return covering.at(-1) ?? null
}

/**
 * Where the station has reports, as hours from the timeline's base. A report
 * outside the rail is not drawn, and neither is one the base has not reached.
 */
export function reportHours(history: HistoryPoint[], base: number): number[] {
  return history
    .map((point) => (Date.parse(point.obs_time) - base) / HOUR_MS)
    .filter((hour) => hour >= -TIMELINE_HOURS && hour <= 0)
    .sort((left, right) => left - right)
}

/**
 * The stretch of the rail the station's forecast covers, clipped to the
 * future half. Null when there is no TAF, or when all of it is behind now.
 */
export function forecastRange(
  taf: BundleTaf | null,
  base: number,
): { from: number; to: number } | null {
  if (taf === null) return null

  let from = Math.max(0, (Date.parse(taf.valid_from) - base) / HOUR_MS)
  let to = Math.min(TIMELINE_HOURS, (Date.parse(taf.valid_to) - base) / HOUR_MS)
  return to <= from ? null : { from, to }
}
