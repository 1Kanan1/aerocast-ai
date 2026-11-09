/** Reading ceiling and visibility out of a stored decoded observation. */

export interface DecodedCloud {
  cover: string
  base_ft: number | null
}

export interface DecodedObservation {
  visibility?: { statute_miles: number | null } | null
  clouds?: DecodedCloud[]
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
