import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { Health } from '#app/lib/api-types.ts'
import type { ApiResult } from '#app/lib/api.ts'
import {
  cardStyle,
  headingStyle,
  mutedStyle,
  Page,
  subheadingStyle,
} from '#app/ui/layout.tsx'

export function AboutPage(handle: Handle<{ health: ApiResult<Health> }>) {
  return () => {
    let { health } = handle.props
    let body = health.data
    let databaseOk = body?.database.ok ?? false
    let providers = body?.llm.providers ?? []
    let provider = providers.find(
      (item) =>
        item.configured && (item.kind === 'remote' || item.reachable === true),
    )

    return (
      <Page active="about">
        <section>
          <h1 mix={headingStyle}>About AeroCast</h1>
          <p mix={ledeStyle}>
            An educational reader for US aviation weather. It exists to answer
            two questions the official site answers poorly: how conditions have
            moved over the last 48 hours, and what the coded text actually says.
          </p>
        </section>

        <section aria-labelledby="sources-heading" mix={cardStyle}>
          <h2 id="sources-heading" mix={subheadingStyle}>
            Sources
          </h2>
          <p mix={paragraphStyle}>
            Every observation, forecast and advisory comes from the Aviation
            Weather Center at aviationweather.gov, which is US Government public
            domain. Model output is not used anywhere: a grid forecast cannot
            say what happened at an airport.
          </p>
          <p mix={paragraphStyle}>
            AWC keeps 30 days of history. AeroCast ingests the bulk cache files,
            stores what it sees, and serves the last known good copy with its
            age attached when upstream is late or down.
          </p>
        </section>

        <section aria-labelledby="checks-heading" mix={cardStyle}>
          <h2 id="checks-heading" mix={subheadingStyle}>
            How the decoding is checked
          </h2>
          <p mix={paragraphStyle}>
            The METAR and TAF parsers are compared field by field against AWC's
            own decoder on every report in the national cache. The last run
            compared 2,545 METARs and 817 TAFs: wind, visibility, cloud layers,
            altimeter and temperature agreed on every report that carried the
            field. Two reported divergences remain, both adjudicated in favour
            of the FAA definition and both pinned by tests.
          </p>
          <p mix={paragraphStyle}>
            Where the parsers do disagree with upstream, the station page says
            so. A disagreement is shown, not smoothed over.
          </p>
        </section>

        <section aria-labelledby="limits-heading" mix={cardStyle}>
          <h2 id="limits-heading" mix={subheadingStyle}>
            What it will not do
          </h2>
          <ul mix={listStyle}>
            <li>No NOTAMs, TFRs, charts, routing or flight planning.</li>
            <li>
              No verdicts. Flight category is a weather classification, never a
              recommendation, and the explanation layer is not allowed to make a
              go/no-go call.
            </li>
            <li>
              No answers about your aircraft, your ratings or your personal
              minimums.
            </li>
          </ul>
        </section>

        <section aria-labelledby="status-heading" mix={cardStyle}>
          <h2 id="status-heading" mix={subheadingStyle}>
            Status
          </h2>
          <StatusRow
            detail={
              health.ok
                ? `v${body?.version ?? '?'}`
                : (health.error ?? 'unreachable')
            }
            label="API"
            ok={health.ok}
          />
          <StatusRow
            detail={
              databaseOk
                ? 'connected'
                : (body?.database.error ?? 'not connected')
            }
            label="Database"
            ok={databaseOk}
          />
          <StatusRow
            detail={
              provider
                ? `${provider.name} · ${provider.model}`
                : 'not configured'
            }
            label="Explanations"
            ok={provider !== undefined}
          />
          {body ? (
            <p mix={mutedStyle}>
              {body.llm.chain.length} providers in the chain; the first one that
              answers inside its budget is used.
            </p>
          ) : null}
        </section>
      </Page>
    )
  }
}

function StatusRow(
  handle: Handle<{ detail: string; label: string; ok: boolean }>,
) {
  return () => {
    let { detail, label, ok } = handle.props

    return (
      <div mix={statusRowStyle}>
        <span
          aria-hidden="true"
          mix={dotStyle}
          style={{ background: ok ? 'var(--ink-0)' : 'transparent' }}
        />
        <span mix={statusLabelStyle}>{label}</span>
        <span mix={mutedStyle}>{detail}</span>
        <span style={{ color: ok ? 'var(--ink-2)' : 'var(--ink-3)' }}>
          {ok ? 'ok' : 'degraded'}
        </span>
      </div>
    )
  }
}

const ledeStyle = css({ margin: 0, maxWidth: '62ch', color: 'var(--ink-2)' })

const paragraphStyle = css({ margin: '0 0 10px', maxWidth: '68ch' })

const listStyle = css({ margin: 0, paddingInlineStart: '18px' })

const statusRowStyle = css({
  display: 'grid',
  gridTemplateColumns: 'auto 8.5rem 1fr auto',
  alignItems: 'center',
  gap: '12px',
  paddingBlock: '8px',
  borderBlockStart: '1px solid var(--line)',
  '@media (max-width: 34rem)': { gridTemplateColumns: 'auto 1fr auto' },
})

const dotStyle = css({
  width: '7px',
  height: '7px',
  borderRadius: '50%',
  border: '1px solid var(--ink-0)',
})

const statusLabelStyle = css({ fontSize: '13px' })
