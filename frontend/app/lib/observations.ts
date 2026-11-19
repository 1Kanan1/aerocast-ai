/** Reading a stored decoded observation into the fields the fact labels read. */

import type { ReportFields } from '#app/lib/public/labels.ts'

export interface DecodedCloud {
  cover: string
  base_ft: number | null
}

export interface DecodedObservation {
  altimeter_in_hg?: number | null
  clouds?: DecodedCloud[]
  dewpoint_c?: number | null
  temperature_c?: number | null
  visibility?: {
    statute_miles: number | null
    is_greater_than?: boolean
    is_less_than?: boolean
  } | null
  weather?: string[]
  wind?: {
    direction_deg?: number | null
    speed_kt?: number | null
    gust_kt?: number | null
    is_variable?: boolean
  } | null
}

/** A ceiling is the lowest broken, overcast or vertical visibility layer. */
const CEILING_COVERS = new Set(['BKN', 'OVC', 'VV'])

export function ceilingFt(decoded: unknown): number | null {
  let clouds = (decoded as DecodedObservation | null)?.clouds ?? []
  let bases = clouds
    .filter(
      (layer) => CEILING_COVERS.has(layer.cover) && layer.base_ft !== null,
    )
    .map((layer) => layer.base_ft as number)

  return bases.length > 0 ? Math.min(...bases) : null
}

export function visibilitySm(decoded: unknown): number | null {
  let visibility = (decoded as DecodedObservation | null)?.visibility
  return visibility?.statute_miles ?? null
}

/**
 * A report kept in `metar_observations.decoded`, shaped so an hour read back
 * from the timeline goes through the same labels as the live report.
 */
export function decodedReport(decoded: unknown): ReportFields {
  let report = (decoded ?? {}) as DecodedObservation
  let wind = report.wind ?? null
  let speed = wind?.speed_kt ?? null
  let temperature = report.temperature_c ?? null
  let dewpoint = report.dewpoint_c ?? null

  return {
    altimeter_in_hg: report.altimeter_in_hg ?? null,
    ceiling: { ft: ceilingFt(report) },
    clouds: (report.clouds ?? []).map((cloud) => ({
      base_ft: cloud.base_ft,
      cover: cloud.cover,
    })),
    temperature:
      temperature === null
        ? null
        : {
            c: temperature,
            dewpoint_c: dewpoint,
            dewpoint_spread_c:
              dewpoint === null
                ? null
                : Math.round((temperature - dewpoint) * 10) / 10,
          },
    visibility:
      report.visibility === undefined || report.visibility === null
        ? null
        : {
            is_greater_than: report.visibility.is_greater_than ?? false,
            is_less_than: report.visibility.is_less_than ?? false,
            statute_miles: report.visibility.statute_miles,
          },
    wind:
      wind === null || speed === null
        ? null
        : {
            direction_deg: wind.direction_deg ?? null,
            gust_kt: wind.gust_kt ?? null,
            is_calm: speed === 0,
            is_variable: wind.is_variable ?? false,
            speed_kt: speed,
          },
    weather: report.weather ?? [],
  }
}
