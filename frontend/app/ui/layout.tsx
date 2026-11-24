import type { Handle, RemixNode } from 'remix/component'
import { css } from 'remix/component'

import { Document } from '#app/actions/document.tsx'
import { ThemeToggle } from '#app/actions/public/theme-toggle.tsx'
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
        <div mix={[tokensStyle, pageStyle]}>
          <div mix={columnStyle}>
            <header mix={mastheadStyle}>
              <a href={routes.home.href()} mix={wordmarkStyle}>
                AEROCAST
              </a>
              <div mix={navRowStyle}>
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
                <ThemeToggle />
              </div>
            </header>

            <main mix={mainStackStyle}>{children}</main>

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
        </div>
      </Document>
    )
  }
}

export const tokensStyle = css({})

export const glassStyle = css({
  background: 'var(--glass)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(20px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(20px) saturate(1.2)',
  transition:
    'background-color 220ms var(--ease-out), border-color 220ms var(--ease-out)',
})

export const pageStyle = css({
  '& *, & *::before, & *::after': { boxSizing: 'border-box' },
  minHeight: '100vh',
  margin: 0,
  padding: 'clamp(24px, 5vw, 64px) 20px',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  fontFamily: 'var(--font-sans)',
  fontSize: '14px',
  lineHeight: 1.6,
  WebkitFontSmoothing: 'antialiased',
  display: 'flex',
  justifyContent: 'center',
  transition:
    'background-color 220ms var(--ease-out), color 220ms var(--ease-out)',
})

export const columnStyle = css({
  width: '100%',
  maxWidth: '960px',
  display: 'flex',
  flexDirection: 'column',
  gap: '28px',
})

const mainStackStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '24px',
})

const mastheadStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '12px 24px',
  paddingBlockEnd: '12px',
  borderBlockEnd: '1px solid var(--line)',
})

const navRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '14px',
})

export const wordmarkStyle = css({
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  color: 'var(--ink-0)',
  textDecoration: 'none',
  '&:focus-visible': {
    outline: '2px solid var(--accent)',
    outlineOffset: '4px',
  },
})

export const navStyle = css({
  display: 'flex',
  gap: '18px',
  '& a': {
    color: 'var(--ink-2)',
    textDecoration: 'none',
    fontWeight: 500,
    transition: 'color 160ms var(--ease-out)',
  },
  '& a:hover': { color: 'var(--ink-0)' },
  '& a:focus-visible': {
    color: 'var(--ink-0)',
    outline: '2px solid var(--accent)',
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
  fontSize: 'clamp(22px, 3.4vw, 30px)',
  fontWeight: 600,
  lineHeight: 1.2,
  letterSpacing: '-0.02em',
})

export const subheadingStyle = css({
  margin: '0 0 12px',
  fontSize: '16px',
  fontWeight: 600,
  color: 'var(--ink-0)',
})

export const cardStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '16px',
  padding: '20px 24px',
  background: 'var(--paper-2)',
  transition:
    'background-color 220ms var(--ease-out), border-color 220ms var(--ease-out)',
  '@media (max-width: 640px)': {
    padding: '16px',
  },
})

export const mutedStyle = css({ color: 'var(--ink-2)' })
