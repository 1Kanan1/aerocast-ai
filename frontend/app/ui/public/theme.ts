import { TypedEventTarget } from 'remix/component'

export type ThemePreference = 'light' | 'dark' | null
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'color-scheme'

function readStorage(): ThemePreference {
  if (typeof localStorage === 'undefined') return null
  try {
    let raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'light' || raw === 'dark' ? raw : null
  } catch {
    return null
  }
}

function writeStorage(value: ThemePreference): void {
  if (typeof localStorage === 'undefined') return
  try {
    if (value === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Storage may be blocked; apply in memory for the current tab.
  }
}

function systemTheme(): ResolvedTheme {
  if (
    typeof window === 'undefined' ||
    typeof window.matchMedia !== 'function'
  ) {
    return 'dark'
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function syncMeta(value: ThemePreference): void {
  if (typeof document === 'undefined') return
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="color-scheme"]',
  )
  if (meta !== null) meta.content = value ?? 'light dark'
}

/**
 * Two-state theme store following system preference by default.
 * Toggling switches to the opposite of the currently rendered scheme:
 * storing an explicit override when diverging from system, and clearing
 * storage when returning to system so OS changes continue to take effect.
 */
export class ThemeStore extends TypedEventTarget<{ change: Event }> {
  #override: ThemePreference
  #system: ResolvedTheme

  constructor(
    initialOverride: ThemePreference = readStorage(),
    initialSystem: ResolvedTheme = systemTheme(),
  ) {
    super()
    this.#override = initialOverride
    this.#system = initialSystem
    syncMeta(this.#override)

    if (typeof window !== 'undefined') {
      if (typeof window.matchMedia === 'function') {
        let query = window.matchMedia('(prefers-color-scheme: dark)')
        query.addEventListener('change', (event) => {
          this.#system = event.matches ? 'dark' : 'light'
          this.dispatchEvent(new Event('change'))
        })
      }
      window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEY) return
        let next: ThemePreference =
          event.newValue === 'light' || event.newValue === 'dark'
            ? event.newValue
            : null
        if (next === this.#override) return
        this.#override = next
        syncMeta(this.#override)
        this.dispatchEvent(new Event('change'))
      })
    }
  }

  get override(): ThemePreference {
    return this.#override
  }

  get resolved(): ResolvedTheme {
    return this.#override ?? this.#system
  }

  toggle(): ResolvedTheme {
    let target: ResolvedTheme = this.resolved === 'dark' ? 'light' : 'dark'
    this.#override = target === this.#system ? null : target
    writeStorage(this.#override)
    syncMeta(this.#override)
    this.dispatchEvent(new Event('change'))
    return this.resolved
  }
}

export const theme = new ThemeStore()
