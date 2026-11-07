/** Flight-category ramp on the dark basemap: the worse the weather, the brighter. */
export const CATEGORY_SHADES: Record<string, string> = {
  VFR: '#4b4b4d',
  MVFR: '#8b8b8d',
  IFR: '#c9c9cb',
  LIFR: '#f4f4f2',
}

export const CATEGORY_BADGES: Record<string, string> = {
  VFR: 'V',
  MVFR: 'M',
  IFR: 'I',
  LIFR: 'L',
}

/** Readable text on a chip painted with the category shade. */
export function categoryInk(category: string | null): string {
  return category === 'IFR' || category === 'LIFR' ? '#0b0b0c' : '#f4f4f2'
}
