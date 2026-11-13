/**
 * A coordinate typed into the search bar: 33.90°N 118.05°W. Two shapes are
 * read, and nothing else, so a question that happens to hold numbers is never
 * mistaken for a place:
 *
 * - a hemisphere letter on each number, with or without the degree sign:
 *   `33.90N 118.05W`, `33.90° N, 118.05° W`
 * - a latitude and longitude separated by a comma, signs allowed:
 *   `33.90, -118.05`, `-33.90, 118.05`
 *
 * Minutes and seconds (`33 54.0N`) are not read: this is decimal degrees.
 */
export interface Coordinates {
  lat: number
  lon: number
}

const HEMISPHERE = /^(\d+(?:\.\d+)?)\s*([ns])\s*,?\s*(\d+(?:\.\d+)?)\s*([we])$/

const PAIR = /^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)$/

export function parseCoordinates(text: string): Coordinates | null {
  let clean = text
    .trim()
    .toLowerCase()
    .replaceAll('°', '')
    .replaceAll('\u2212', '-')
    .replace(/\s+/g, ' ')

  let hemisphere = HEMISPHERE.exec(clean)
  if (hemisphere !== null) {
    let lat = Number(hemisphere[1]) * (hemisphere[2] === 's' ? -1 : 1)
    let lon = Number(hemisphere[3]) * (hemisphere[4] === 'w' ? -1 : 1)
    return inRange(lat, lon)
  }

  let pair = PAIR.exec(clean)
  if (pair !== null) {
    return inRange(Number(pair[1]), Number(pair[2]))
  }

  return null
}

function inRange(lat: number, lon: number): Coordinates | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null
  return { lat, lon }
}
