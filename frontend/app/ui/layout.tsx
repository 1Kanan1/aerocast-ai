import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { Document } from '#app/actions/document.tsx'
import { routes } from '#app/routes.ts'

export interface PageProps {
  active: 'map' | 'advisories' | 'about'
  children?: RemixNode
  title?: string
}

/** The shell every page shares: masthead, navigation, and the safety footer. */
export function Page(handle: Handle<PageProps>) {
  return () => {
    let { active, children, title } = handle.props

    return (
      <Document title={title}>
        <main mix={[tokensStyle, pageStyle]}>
          <div mix={columnStyle}>
            <header mix={mastheadStyle}>
              <a href={routes.home.href()} mix={wordmarkStyle}>
                AEROCAST
              </a>
              <nav mix={navStyle}>
                <a
                  aria-current={active === 'map' ? 'page' : undefined}
                  href={routes.home.href()}
                >
                  Map
                </a>
                <a
                  aria-current={active === 'advisories' ? 'page' : undefined}
                  href={routes.advisories.href()}
                >
                  Advisories
                </a>
                <a
                  aria-current={active === 'about' ? 'page' : undefined}
                  href={routes.about.href()}
                >
                  About
                </a>
              </nav>
            </header>

            {children}

            <footer mix={footerStyle}>
              <p>
                Educational tool. Not for flight planning. Obtain an official
                briefing from Flight Service (1-800-WX-BRIEF) before you fly.
              </p>
              <p>
                Weather data: aviationweather.gov, US Government public domain.
              </p>
            </footer>
          </div>
        </main>
      </Document>
    )
  }
}

export const tokensStyle = css({
  colorScheme: 'dark',
  '--ink-0': '#f4f4f2',
  '--ink-1': '#d7d7d3',
  '--ink-2': '#a6a6a1',
  '--ink-3': '#83837e',
  '--line': 'rgba(255, 255, 255, 0.10)',
  '--paper': '#09090a',
  '--paper-2': '#101012',
  '--accent': '#e0603f',
  '--glass': 'rgba(22, 22, 25, 0.62)',
  '--glass-strong': 'rgba(24, 24, 28, 0.86)',
  '--glass-border': 'rgba(255, 255, 255, 0.09)',
  '--shadow': '0 24px 70px rgba(0, 0, 0, 0.55)',
})

export const glassStyle = css({
  background: 'var(--glass)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
})

export const pageStyle = css({
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  margin: 0,
  padding: 'clamp(28px, 6vw, 72px) 24px',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  fontFamily:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  fontSize: '14px',
  lineHeight: 1.6,
  WebkitFontSmoothing: 'antialiased',
  display: 'flex',
  justifyContent: 'center',
})

export const columnStyle = css({
  width: '100%',
  maxWidth: '960px',
  display: 'flex',
  flexDirection: 'column',
  gap: '32px',
})

const mastheadStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '12px 24px',
  paddingBlockEnd: '12px',
  borderBlockEnd: '1px solid var(--line)',
})

export const wordmarkStyle = css({
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  color: 'var(--ink-0)',
  textDecoration: 'none',
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '4px',
  },
})

export const navStyle = css({
  display: 'flex',
  gap: '18px',
  '& a': { color: 'var(--ink-3)', textDecoration: 'none' },
  '& a:hover': { color: 'var(--ink-1)' },
  '& a:focus-visible': {
    color: 'var(--ink-0)',
    outline: '2px solid var(--ink-2)',
    outlineOffset: '4px',
  },
  '& a[aria-current="page"]': {
    color: 'var(--ink-0)',
    textDecoration: 'underline',
    textUnderlineOffset: '6px',
  },
})

const footerStyle = css({
  marginBlockStart: '8px',
  paddingBlockStart: '16px',
  borderBlockStart: '1px solid var(--line)',
  fontSize: '12px',
  color: 'var(--ink-3)',
  '& p': { margin: '0 0 6px' },
})

export const headingStyle = css({
  margin: '0 0 4px',
  fontSize: 'clamp(24px, 3.6vw, 32px)',
  fontWeight: 400,
  lineHeight: 1.15,
  letterSpacing: '-0.01em',
})

export const subheadingStyle = css({
  margin: '0 0 12px',
  fontSize: '16px',
  fontWeight: 400,
  color: 'var(--ink-1)',
})

export const cardStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '16px',
  padding: '20px 24px',
  background: 'var(--paper-2)',
})

export const mutedStyle = css({ color: 'var(--ink-3)' })
