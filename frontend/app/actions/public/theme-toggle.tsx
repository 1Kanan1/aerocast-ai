import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { MoonIcon, SunIcon } from '#app/ui/public/icons.tsx'
import { theme } from '#app/ui/public/theme.ts'

/** Two-state light/dark toggle button synced with system preference. */
export const ThemeToggle = clientEntry(
  import.meta.url,
  function ThemeToggle(handle: Handle) {
    theme.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    return () => {
      let isDark = theme.resolved === 'dark'
      let label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

      return (
        <button
          aria-label={label}
          aria-pressed={isDark ? 'true' : 'false'}
          mix={[
            buttonStyle,
            on('click', () => {
              theme.toggle()
            }),
          ]}
          title={label}
          type="button"
        >
          <span key={isDark ? 'sun' : 'moon'} mix={iconWrapStyle}>
            {isDark ? <SunIcon /> : <MoonIcon />}
          </span>
        </button>
      )
    }
  },
)

const buttonStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '36px',
  height: '36px',
  padding: 0,
  borderRadius: '999px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  transition:
    'background 160ms var(--ease-out), color 160ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': {
    background: 'var(--hover-bg)',
    color: 'var(--ink-0)',
  },
  '&:active': {
    transform: 'scale(0.92)',
  },
})

const iconWrapStyle = css({
  display: 'grid',
  placeItems: 'center',
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-icon-in 240ms var(--ease-spring) both',
  },
})
