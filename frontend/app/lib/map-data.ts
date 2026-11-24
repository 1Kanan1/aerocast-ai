import type { MapLayers } from './api-types.ts'

/** The narrow view of a layer payload that the browser island needs. */
export interface IslandGeometry {
  type: 'Polygon' | 'LineString'
  coordinates: number[][] | number[][][]
}

export interface IslandAdvisory {
  base_ft: number | null
  due_to: string | null
  geometry: IslandGeometry
  hazard: string
  kind: string
  severity: string | null
  source_id: string
  top_ft: number | null
  valid_from: string | null
  valid_to: string | null
}

export interface IslandStation {
  category: string | null
  icao: string
  lat: number
  lon: number
  name: string
}

export interface IslandLayers {
  advisories: IslandAdvisory[]
  stations: IslandStation[]
}

export const EMPTY_LAYERS: IslandLayers = { advisories: [], stations: [] }

export function islandLayers(layers: MapLayers): IslandLayers {
  return {
    advisories: layers.advisories.map(
      ({
        base_ft = null,
        due_to = null,
        geometry,
        hazard,
        kind,
        severity = null,
        source_id,
        top_ft = null,
        valid_from = null,
        valid_to = null,
      }) => ({
        base_ft,
        due_to,
        geometry: geometry as unknown as IslandGeometry,
        hazard,
        kind,
        severity,
        source_id,
        top_ft,
        valid_from,
        valid_to,
      }),
    ),
    stations: (layers.stations ?? []).map(
      ({ category = null, icao, lat, lon, name }) => ({
        category,
        icao,
        lat,
        lon,
        name,
      }),
    ),
  }
}
