import type { MapLayers } from './api-types.ts'

/** The narrow view of a layer payload that the browser island needs. */
export interface IslandGeometry {
  type: 'Polygon' | 'LineString'
  coordinates: number[][] | number[][][]
}

export interface IslandAdvisory {
  geometry: IslandGeometry
  hazard: string
  kind: string
  source_id: string
}

export interface IslandLayers {
  advisories: IslandAdvisory[]
}

export const EMPTY_LAYERS: IslandLayers = { advisories: [] }

export function islandLayers(layers: MapLayers): IslandLayers {
  return {
    advisories: layers.advisories.map(
      ({ geometry, hazard, kind, source_id }) => ({
        geometry: geometry as unknown as IslandGeometry,
        hazard,
        kind,
        source_id,
      }),
    ),
  }
}
