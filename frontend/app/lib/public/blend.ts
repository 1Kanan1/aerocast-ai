import type { BundleMetar } from '#app/lib/api-types.ts'

/** One report as the blend sees it: how far away, and what it says. */
export interface BlendStation {
  distance_nm: number
  metar: BundleMetar | null
}

/** Weighted midpoints for a point, drawn from the reports around it. */
export interface Blend {
  /** Reports that carried a value, and reports offered. */
  used: number
  total: number
  distance_nm: number | null
  wind: {
    direction_deg: number
    speed_kt: number
    gust_kt: number | null
  } | null
  visibility_sm: {
    value: number
    low: number
    high: number
  } | null
  ceiling_ft: {
    value: number
    reports: number
  } | null
  temperature_c: number | null
  humidity_pct: number | null
}

/**
 * A distance-weighted view of the reports inside the radius.
 *
 * This is a summary, not a measurement: the nearest station pulls hardest,
 * and every field says whether it was built from all reports or only some.
 */
export function blendStations(stations: BlendStation[]): Blend | null {
  if (stations.length === 0) return null

  let readings = stations
    .filter(
      (station): station is { distance_nm: number; metar: BundleMetar } =>
        station.metar !== null,
    )
    .map((station) => ({
      metar: station.metar,
      distance: station.distance_nm,
      weight: 1 / (station.distance_nm + 1),
    }))

  if (readings.length === 0) return null

  let visibility = weighted(readings, (item) =>
    item.metar.visibility === null ? null : item.metar.visibility.statute_miles,
  )
  let visibilityValues = readings
    .map((item) => item.metar.visibility?.statute_miles ?? null)
    .filter((value): value is number => value !== null)

  let ceilingValue = weighted(readings, (item) => item.metar.ceiling.ft)
  let ceilingReports = readings.filter(
    (item) => item.metar.ceiling.ft !== null,
  ).length
  let ceiling =
    ceilingValue === null
      ? null
      : {
          value: Math.round(ceilingValue),
          reports: ceilingReports,
        }

  let wind = blendedWind(readings)

  let temperature = weighted(readings, (item) =>
    item.metar.temperature === null ? null : item.metar.temperature.c,
  )
  let humidity = weighted(readings, (item) =>
    item.metar.humidity === null ? null : item.metar.humidity.relative_pct,
  )

  return {
    used: readings.length,
    total: stations.length,
    distance_nm: Math.min(...readings.map((item) => item.distance)),
    wind,
    visibility_sm:
      visibility === null
        ? null
        : {
            value: Math.round(visibility * 10) / 10,
            low: Math.min(...visibilityValues),
            high: Math.max(...visibilityValues),
          },
    ceiling_ft: ceiling,
    temperature_c:
      temperature === null ? null : Math.round(temperature * 10) / 10,
    humidity_pct: humidity === null ? null : Math.round(humidity),
  }
}

type Reading = {
  metar: BundleMetar
  distance: number
  weight: number
}

function weighted(
  readings: Reading[],
  pick: (reading: Reading) => number | null,
): number | null {
  let sum = 0
  let weights = 0

  for (let reading of readings) {
    let value = pick(reading)
    if (value === null) continue
    sum += value * reading.weight
    weights += reading.weight
  }

  return weights === 0 ? null : sum / weights
}

/** Directions average as vectors, or opposite winds would cancel to zero. */
function blendedWind(readings: Reading[]): Blend['wind'] {
  let east = 0
  let north = 0
  let gust = 0
  let weight = 0
  let gustWeight = 0

  for (let reading of readings) {
    let wind = reading.metar.wind
    if (wind === null || wind.speed_kt === null) continue
    if (wind.direction_deg === null || wind.is_variable) continue

    let radians = (wind.direction_deg * Math.PI) / 180
    // Meteorological direction: the direction the wind comes from.
    east -= Math.sin(radians) * wind.speed_kt * reading.weight
    north -= Math.cos(radians) * wind.speed_kt * reading.weight
    weight += reading.weight

    if (wind.gust_kt !== null) {
      gust += wind.gust_kt * reading.weight
      gustWeight += reading.weight
    }
  }

  if (weight === 0) return null

  let speed = Math.hypot(east, north) / weight
  let direction = ((Math.atan2(-east, -north) * 180) / Math.PI + 360) % 360

  return {
    direction_deg: (Math.round(direction / 10) * 10) % 360,
    speed_kt: Math.round(speed),
    gust_kt: gustWeight === 0 ? null : Math.round(gust / gustWeight),
  }
}
