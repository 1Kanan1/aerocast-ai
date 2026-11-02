import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { ApiResult, HealthResponse, ProviderStatus } from '../lib/api.ts'
import { Document } from './document.tsx'

interface HomePageProps {
  health: ApiResult<HealthResponse>
}

export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    let { health } = handle.props
    let body = health.data
    let reachable = health.ok && body !== undefined
    let databaseOk = body?.database.ok ?? false
    let providers = body?.llm.providers ?? []
    let activeProvider = pickProvider(providers)

    return (
      <Document
        head={
          <meta
            name="description"
            content="AeroCast AI: aviation weather, explained and cited. Educational tool, not for flight planning."
          />
        }
      >
        <main mix={pageStyle}>
          <div mix={columnStyle}>
            <header mix={mastheadStyle}>
              <span mix={wordmarkStyle}>AEROCAST</span>
              <span mix={buildStyle}>{body ? `v${body.version} · ${body.env}` : 'offline'}</span>
            </header>

            <section>
              <h1 mix={headlineStyle}>Aviation weather, explained and cited.</h1>
              <p mix={ledeStyle}>
                METAR, TAF, advisories and a 48 hour history for US airports. Every AI
                sentence points back at the observation it came from. Nothing here decides
                whether you should fly.
              </p>
            </section>

            <section mix={panelStyle} aria-labelledby="status-heading">
              <h2 id="status-heading" mix={panelHeadingStyle}>
                System status
              </h2>
              <StatusRow
                detail={reachable ? 'responding' : (health.error ?? 'unreachable')}
                label="API"
                ok={reachable}
              />
              <StatusRow
                detail={databaseOk ? 'connected' : (body?.database.error ?? 'not configured')}
                label="Database"
                ok={databaseOk}
              />
              <StatusRow
                detail={
                  activeProvider
                    ? `${activeProvider.name} · ${activeProvider.model}`
                    : providers.length > 0
                      ? 'no provider reachable'
                      : 'deterministic summaries only'
                }
                label="Explanation"
                ok={activeProvider !== undefined}
              />
            </section>

            <footer mix={footerStyle}>
              <p>
                Educational tool. Not for flight planning. Obtain an official briefing from
                Flight Service (1-800-WX-BRIEF) before you fly.
              </p>
              <p>Weather data: aviationweather.gov, US Government public domain.</p>
            </footer>
          </div>
        </main>
      </Document>
    )
  }
}

function pickProvider(providers: ProviderStatus[]): ProviderStatus | undefined {
  // A remote provider with a key counts as usable; the local one must also answer.
  return providers.find(
    (provider) => provider.configured && (provider.kind === 'remote' || provider.reachable === true),
  )
}

function StatusRow(handle: Handle<{ detail: string; label: string; ok: boolean }>) {
  return () => {
    let { detail, label, ok } = handle.props

    return (
      <div mix={rowStyle}>
        <span
          aria-hidden="true"
          mix={dotStyle}
          style={{ background: ok ? 'var(--ink-0)' : 'transparent' }}
        />
        <span mix={rowLabelStyle}>{label}</span>
        <span mix={rowDetailStyle}>{detail}</span>
        <span style={{ color: ok ? 'var(--ink-2)' : 'var(--ink-3)' }}>{ok ? 'ok' : 'degraded'}</span>
      </div>
    )
  }
}

const pageStyle = css({
  '--ink-0': '#0a0a0a',
  '--ink-1': '#1a1a1a',
  '--ink-2': '#3d3d3d',
  '--ink-3': '#6b6b6b',
  '--line': '#d4d4d4',
  '--paper': '#fafafa',
  '--paper-2': '#f0efed',
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

const columnStyle = css({
  width: '100%',
  maxWidth: '720px',
  display: 'flex',
  flexDirection: 'column',
  gap: '40px',
})

const mastheadStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: '16px',
  paddingBlockEnd: '12px',
  borderBlockEnd: '1px solid var(--line)',
})

const wordmarkStyle = css({
  fontSize: '13px',
  fontWeight: 700,
  letterSpacing: '0.22em',
})

const buildStyle = css({
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const headlineStyle = css({
  margin: '0 0 16px',
  fontSize: 'clamp(28px, 5vw, 40px)',
  lineHeight: 1.15,
  letterSpacing: '-0.02em',
  fontWeight: 700,
})

const ledeStyle = css({
  margin: 0,
  maxWidth: '58ch',
  color: 'var(--ink-2)',
})

const panelStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '10px',
  padding: '16px 20px 4px',
  background: 'var(--paper-2)',
})

const panelHeadingStyle = css({
  margin: '0 0 12px',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-2)',
})

const rowStyle = css({
  display: 'grid',
  gridTemplateColumns: 'auto 8.5rem 1fr auto',
  alignItems: 'center',
  gap: '12px',
  paddingBlock: '10px',
  borderBlockStart: '1px solid var(--line)',
  '@media (max-width: 34rem)': {
    gridTemplateColumns: 'auto 1fr auto',
  },
})

const dotStyle = css({
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  border: '1px solid var(--ink-0)',
})

const rowLabelStyle = css({
  fontWeight: 700,
})

const rowDetailStyle = css({
  color: 'var(--ink-3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  '@media (max-width: 34rem)': {
    display: 'none',
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
