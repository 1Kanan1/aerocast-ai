/**
 * True when the user asked their system for less motion. The components also
 * render on the server, where no preference exists and motion is the default.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
