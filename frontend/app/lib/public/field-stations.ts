import type { AreaPayload, BundleWind } from '#app/lib/api-types.ts'

/** A station's own readings, which its weather field is drawn from. */
export interface FieldStation {
  icao: string
  lat: number
  lon: number
  /** The station's own temperature in °C, or null when it has no report. */
  temperature: number | null
  /** The station's own wind, or null when it has no report. */
  wind: BundleWind | null
}

/** Every station inside an area, each with its own report and no blending. */
export function areaFieldStations(payload: AreaPayload): FieldStation[] {
  return payload.stations.map((station) => {
    let metar =
      payload.brief?.stations.find((entry) => entry.icao === station.icao)
        ?.metar ?? null

    return {
      icao: station.icao,
      lat: station.lat,
      lon: station.lon,
      temperature: metar?.temperature?.c ?? null,
      wind: metar?.wind ?? null,
    }
  })
}

/**
 * Where a point sits from a centre, in screen pixels on a north-up map: east
 * is +x and south is +y. Good to a few tens of nautical miles, which is the
 * scale of an area.
 */
export function screenOffset(
  centreLat: number,
  centreLon: number,
  lat: number,
  lon: number,
  pxPerNm: number,
): { x: number; y: number } {
  let eastNm = (lon - centreLon) * 60 * Math.cos((centreLat * Math.PI) / 180)
  let northNm = (lat - centreLat) * 60

  return { x: eastNm * pxPerNm, y: -northNm * pxPerNm }
}
