import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { Document } from '../actions/document.tsx'
import { routes } from '../routes.ts'

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
        <main mix={pageStyle}>
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
              <p>Weather data: aviationweather.gov, US Government public domain.</p>
            </footer>
          </div>
        </main>
      </Document>
    )
  }
}

export const pageStyle = css({
  '--ink-0': '#0a0a0a',
  '--ink-1': '#1a1a1a',
  '--ink-2': '#3d3d3d',
  '--ink-3': '#6b6b6b',
  '--line': '#d4d4d4',
  '--paper': '#fafafa',
  '--paper-2': '#f0efed',
  '--accent': '#b23a1f',
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  margin: 0,
  padding: 'clamp(28px, 6vw, 72px) 24px',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
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

const wordmarkStyle = css({
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.22em',
  color: 'var(--ink-0)',
  textDecoration: 'none',
})

const navStyle = css({
  display: 'flex',
  gap: '18px',
  '& a': { color: 'var(--ink-3)', textDecoration: 'none' },
  '& a:hover': { color: 'var(--ink-1)' },
  '& a[aria-current="page"]': {
    color: 'var(--ink-0)',
    fontWeight: 700,
    textDecoration: 'underline',
    textUnderlineOffset: '4px',
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
  fontSize: 'clamp(22px, 4vw, 30px)',
  lineHeight: 1.2,
  letterSpacing: '-0.01em',
})

export const subheadingStyle = css({
  margin: '0 0 12px',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
})

export const cardStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '10px',
  padding: '16px 20px',
  background: 'var(--paper-2)',
})

export const mutedStyle = css({ color: 'var(--ink-3)' })
