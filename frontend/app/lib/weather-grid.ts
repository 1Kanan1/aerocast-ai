/**
 * Open-Meteo's RRFS (Rapid Refresh Forecast System) grid, the modern NCEP
 * replacement for HRRR and NAM. One request covers a small square of points
 * around the station, which is enough to draw a wind field that bends instead
 * of a single arrow.
 */

export const GRID_SIZE = 4

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast'
const MODEL = 'ncep_rrfs_conus'

export interface WindCell {
  /** Flow towards the east, knots. */
  u: number
  /** Flow towards the north, knots. */
  v: number
  speed: number
  temperature: number
  humidity: number
}

export interface WeatherGrid {
  size: number
  /** Row-major, south to north, west to east. */
  cells: WindCell[]
}

export async function fetchWeatherGrid(
  lat: number,
  lon: number,
  radiusNm: number,
  signal: AbortSignal,
  at?: number,
): Promise<WeatherGrid | null> {
  let latitudes: number[] = []
  let longitudes: number[] = []
  let latitudeSpan = radiusNm / 60
  let longitudeSpan = radiusNm / (60 * Math.cos((lat * Math.PI) / 180))

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let column = 0; column < GRID_SIZE; column++) {
      let south = (row / (GRID_SIZE - 1)) * 2 - 1
      let west = (column / (GRID_SIZE - 1)) * 2 - 1
      latitudes.push(Number((lat + south * latitudeSpan).toFixed(3)))
      longitudes.push(Number((lon + west * longitudeSpan).toFixed(3)))
    }
  }

  let query = new URLSearchParams({
    latitude: latitudes.join(','),
    longitude: longitudes.join(','),
    models: MODEL,
    wind_speed_unit: 'kn',
    timezone: 'UTC',
  })

  if (at === undefined) {
    query.set(
      'current',
      'wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m',
    )
  } else {
    // The same model answers for an hour in the past or ahead when asked for
    // that hour, so the timeline reads one grid shape either way.
    let hour = `${new Date(at).toISOString().slice(0, 13)}:00`
    query.set(
      'hourly',
      'wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m',
    )
    query.set('start_hour', hour)
    query.set('end_hour', hour)
  }

  try {
    let response = await fetch(`${ENDPOINT}?${query}`, { signal })
    if (!response.ok) return null

    let payload = (await response.json()) as unknown
    let rows = Array.isArray(payload) ? payload : [payload]
    if (rows.length !== GRID_SIZE * GRID_SIZE) return null

    let cells = rows.map((row) =>
      at === undefined ? toCell(row) : toHourCell(row),
    )
    if (cells.some((cell) => cell === null)) return null

    return { size: GRID_SIZE, cells: cells as WindCell[] }
  } catch {
    return null
  }
}

interface OpenMeteoRow {
  current?: {
    wind_speed_10m?: number
    wind_direction_10m?: number
    temperature_2m?: number
    relative_humidity_2m?: number
  }
  hourly?: {
    wind_speed_10m?: number[]
    wind_direction_10m?: number[]
    temperature_2m?: number[]
    relative_humidity_2m?: number[]
  }
}

function toCell(row: unknown): WindCell | null {
  let current = (row as OpenMeteoRow).current
  return cell(
    current?.wind_speed_10m,
    current?.wind_direction_10m,
    current?.temperature_2m,
    current?.relative_humidity_2m,
  )
}

function toHourCell(row: unknown): WindCell | null {
  let hourly = (row as OpenMeteoRow).hourly
  return cell(
    hourly?.wind_speed_10m?.[0],
    hourly?.wind_direction_10m?.[0],
    hourly?.temperature_2m?.[0],
    hourly?.relative_humidity_2m?.[0],
  )
}

function cell(
  speed: number | undefined,
  direction: number | undefined,
  temperature: number | undefined,
  humidity: number | undefined,
): WindCell | null {
  // The model leaves an hour it cannot answer as null, which would otherwise
  // become a NaN arrow.
  if (!isNumber(speed) || !isNumber(direction) || !isNumber(temperature))
    return null

  // The API reports the direction the wind comes from; the field draws where
  // it goes.
  let radians = (direction * Math.PI) / 180
  return {
    u: -Math.sin(radians) * speed,
    v: -Math.cos(radians) * speed,
    speed,
    temperature,
    humidity: isNumber(humidity) ? humidity : 0,
  }
}

function isNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * Bilinear sample of the flow and temperature at a point in the area, where
 * (-1, -1) is the south-west corner and (1, 1) the north-east one.
 */
export function sampleGrid(
  grid: WeatherGrid,
  east: number,
  north: number,
): { u: number; v: number; speed: number; temperature: number } | null {
  if (grid.cells.length !== grid.size * grid.size) return null

  let gx = clamp(((east + 1) / 2) * (grid.size - 1), 0, grid.size - 1)
  let gy = clamp(((north + 1) / 2) * (grid.size - 1), 0, grid.size - 1)
  let x0 = Math.floor(gx)
  let y0 = Math.floor(gy)
  let x1 = Math.min(x0 + 1, grid.size - 1)
  let y1 = Math.min(y0 + 1, grid.size - 1)
  let fx = gx - x0
  let fy = gy - y0

  let at = (x: number, y: number) => grid.cells[y * grid.size + x]
  let corners: [WindCell, number][] = [
    [at(x0, y0), (1 - fx) * (1 - fy)],
    [at(x1, y0), fx * (1 - fy)],
    [at(x0, y1), (1 - fx) * fy],
    [at(x1, y1), fx * fy],
  ]

  let u = 0
  let v = 0
  let temperature = 0
  for (let [cell, weight] of corners) {
    u += cell.u * weight
    v += cell.v * weight
    temperature += cell.temperature * weight
  }

  return {
    u,
    v,
    speed: Math.hypot(u, v),
    temperature,
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
