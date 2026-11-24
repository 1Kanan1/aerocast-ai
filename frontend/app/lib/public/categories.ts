/** Desaturated FAA flight-category tokens (always paired with text labels). */
export const CATEGORY_SHADES: Record<string, string> = {
  VFR: 'var(--vfr-bg)',
  MVFR: 'var(--mvfr-bg)',
  IFR: 'var(--ifr-bg)',
  LIFR: 'var(--lifr-bg)',
}

/** High-contrast foreground token on the matching flight-category badge. */
export function categoryInk(category: string | null): string {
  switch (category) {
    case 'VFR':
      return 'var(--vfr-ink)'
    case 'MVFR':
      return 'var(--mvfr-ink)'
    case 'IFR':
      return 'var(--ifr-ink)'
    case 'LIFR':
      return 'var(--lifr-ink)'
    default:
      return 'var(--ink-2)'
  }
}

/** Muted FAA marker dot colors for map circles (hex for WebGL paint). */
export const CATEGORY_DOTS: Record<string, string> = {
  VFR: '#5a9e76',
  MVFR: '#5f87be',
  IFR: '#bf6363',
  LIFR: '#a66ca6',
}
