import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type {
  Bundle,
  BundleMetar,
  BundlePeriod,
  StationBrief,
  StationDetailResponse,
  StationHistory,
} from '../lib/api-types.ts'
import type { ApiResult } from '../lib/api.ts'
import { ageLabel, timeLabel, windowLabel } from '../lib/format.ts'
import { routes } from '../routes.ts'
import { cardStyle, headingStyle, mutedStyle, Page, subheadingStyle } from '../ui/layout.tsx'
import { Timeline, timelinePoints } from '../ui/timeline.tsx'
import { AskPanel } from './public/ask-panel.tsx'

interface StationPageProps {
  brief: ApiResult<StationBrief>
  detail: StationDetailResponse
  history: ApiResult<StationHistory>
  askHref: string
}

export function StationPage(handle: Handle<StationPageProps>) {
  return () => {
    let { brief, detail, history, askHref } = handle.props
    let station = detail.data.station
    let metar = detail.data.metar
    let taf = detail.data.taf
    let bundle: Bundle | undefined = brief.data?.data
    let facts = bundle?.stations[0]?.metar ?? null
    let forecast = bundle?.stations[0]?.taf ?? null
    let category = facts?.flight_category.value ?? metar?.category ?? null

    return (
      <Page active="map" title={`${station.icao} · AeroCast AI`}>
        <section>
          <p mix={crumbStyle}>
            <a href={routes.home.href()}>← All stations</a>
          </p>
          <div mix={titleRowStyle}>
            <h1 mix={headingStyle}>
              {station.icao} · {station.name}
              {station.state ? `, ${station.state}` : ''}
            </h1>
            <CategoryBadge category={category} />
          </div>
          <p mix={metaStyle}>
            METAR from {detail.meta.source} · observed{' '}
            {timeLabel(detail.meta.observed_at)} ·{' '}
            {ageLabel(detail.meta.age_seconds)}
            {detail.meta.stale ? <span mix={staleStyle}>stale</span> : null}
          </p>
        </section>

        <section aria-labelledby="metar-heading" mix={cardStyle}>
          <h2 id="metar-heading" mix={subheadingStyle}>
            Observation
          </h2>
          {metar === null ? (
            <p mix={mutedStyle}>No observation on file for this station.</p>
          ) : (
            <>
              <code mix={rawStyle}>{metar.raw}</code>
              {metar.parse_status !== 'ok' ? (
                <p mix={warningStyle}>
                  Our parser disagrees with AWC on this report
                  {metar.upstream_category
                    ? ` (upstream category ${metar.upstream_category})`
                    : ''}
                  . The difference is kept visible rather than resolved.
                </p>
              ) : null}
              {facts === null ? (
                <p mix={mutedStyle}>
                  Decoded facts are unavailable right now. The raw report above
                  is the source of record.
                </p>
              ) : (
                <Facts facts={facts} />
              )}
            </>
          )}
        </section>

        <section aria-labelledby="taf-heading" mix={cardStyle}>
          <h2 id="taf-heading" mix={subheadingStyle}>
            Forecast
          </h2>
          {forecast ? (
            <TafTable taf={forecast} />
          ) : taf === null ? (
            <p mix={mutedStyle}>No TAF on file for this station.</p>
          ) : (
            <code mix={rawStyle}>{taf.raw}</code>
          )}
        </section>

        <section aria-labelledby="timeline-heading" mix={cardStyle}>
          <h2 id="timeline-heading" mix={subheadingStyle}>
            Last 48 hours
          </h2>
          {history.ok && history.data ? (
            <Timeline points={timelinePoints(history.data.data)} />
          ) : (
            <p mix={mutedStyle}>The history feed is unavailable right now.</p>
          )}
        </section>

        <section aria-labelledby="advisories-heading" mix={cardStyle}>
          <h2 id="advisories-heading" mix={subheadingStyle}>
            Advisories within 50 nm
          </h2>
          {detail.data.advisories.length === 0 ? (
            <p mix={mutedStyle}>No active advisories nearby.</p>
          ) : (
            <ul mix={advisoryListStyle}>
              {detail.data.advisories.map((advisory) => (
                <li key={`${advisory.kind}-${advisory.source_id}`}>
                  <span mix={hazardStyle}>{advisory.hazard}</span>
                  <span>
                    {advisory.kind.toUpperCase()} {advisory.source_id}
                  </span>
                  <span mix={mutedStyle}>
                    {advisory.distance_nm.toFixed(0)} nm
                    {advisory.top_ft
                      ? ` · to ${advisory.top_ft.toLocaleString()} ft`
                      : ''}
                  </span>
                  <span mix={mutedStyle}>
                    until {timeLabel(advisory.valid_to)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="ask-heading" mix={cardStyle}>
          <h2 id="ask-heading" mix={subheadingStyle}>
            Ask about this station
          </h2>
          <AskPanel action={askHref} />
        </section>
      </Page>
    )
  }
}

function CategoryBadge(handle: Handle<{ category: string | null }>) {
  return () => {
    let { category } = handle.props
    let index = category === null ? 3 : ['VFR', 'MVFR', 'IFR', 'LIFR'].indexOf(category)
    let shades = ['#d0d0d0', '#8c8c8c', '#3d3d3d', '#0a0a0a']

    return (
      <span
        mix={badgeStyle}
        style={{
          background: shades[Math.max(0, index)],
          color: index < 1 ? 'var(--ink-0)' : 'var(--paper)',
        }}
      >
        {category ?? 'no data'}
      </span>
    )
  }
}

function Facts(handle: Handle<{ facts: BundleMetar }>) {
  return () => {
    let { facts } = handle.props

    return (
      <>
        <dl mix={factsStyle}>
          <Fact label="Wind" value={windLabel(facts)} />
          <Fact label="Visibility" value={visibilityLabel(facts)} />
          <Fact
            label="Ceiling"
            value={facts.ceiling.ft === null ? 'no ceiling' : `${facts.ceiling.ft.toLocaleString()} ft`}
          />
          <Fact
            label="Temperature"
            value={
              facts.temperature === null
                ? 'not reported'
                : `${facts.temperature.c} °C / dewpoint ${facts.temperature.dewpoint_c} °C` +
                  (facts.temperature.dewpoint_spread_c === null
                    ? ''
                    : `, spread ${facts.temperature.dewpoint_spread_c} °C`)
            }
          />
          <Fact
            label="Altimeter"
            value={
              facts.altimeter_in_hg === null
                ? 'not reported'
                : `${facts.altimeter_in_hg} inHg`
            }
          />
          <Fact
            label="Weather"
            value={facts.weather.length === 0 ? 'none' : facts.weather.join(' ')}
          />
          <Fact
            label="Clouds"
            value={
              facts.clouds.length === 0
                ? 'none'
                : facts.clouds
                    .map(
                      (cloud) =>
                        `${cloud.cover} ${cloud.base_ft?.toLocaleString() ?? '—'} ft`,
                    )
                    .join(', ')
            }
          />
        </dl>
        <p mix={basisStyle}>{facts.flight_category.basis}</p>
      </>
    )
  }
}

function Fact(handle: Handle<{ label: string; value: string }>) {
  return () => (
    <div mix={factStyle}>
      <dt>{handle.props.label}</dt>
      <dd>{handle.props.value}</dd>
    </div>
  )
}

function TafTable(handle: Handle<{ taf: NonNullable<Bundle['stations'][0]['taf']> }>) {
  return () => {
    let { taf } = handle.props

    return (
      <>
        <p mix={validityStyle}>
          Issued {timeLabel(taf.issued_at)} · valid{' '}
          {windowLabel(taf.valid_from, taf.valid_to)}
        </p>
        <table mix={tableStyle}>
          <thead>
            <tr>
              <th>Period</th>
              <th>Window</th>
              <th>Wind</th>
              <th>Visibility</th>
              <th>Ceiling</th>
              <th>Weather</th>
            </tr>
          </thead>
          <tbody>
            {taf.periods.map((period) => (
              <tr key={period.ref}>
                <td>{period.change}</td>
                <td>{windowLabel(period.from, period.to)}</td>
                <td>{periodWind(period)}</td>
                <td>
                  {period.visibility_sm === null
                    ? '—'
                    : `${period.visibility_sm} SM`}
                </td>
                <td>
                  {period.ceiling_ft === null
                    ? 'none'
                    : `${period.ceiling_ft.toLocaleString()} ft`}
                </td>
                <td>
                  {period.weather.length === 0 ? '—' : period.weather.join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    )
  }
}

function windLabel(facts: BundleMetar): string {
  let wind = facts.wind
  if (wind === null) return 'not reported'
  if (wind.is_calm) return 'calm'
  let direction = wind.is_variable ? 'variable' : `${wind.direction_deg}°`
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt} kt`
  return `${direction} at ${wind.speed_kt} kt${gust}`
}

function visibilityLabel(facts: BundleMetar): string {
  let visibility = facts.visibility
  if (visibility === null) return 'not reported'
  let qualifier = visibility.is_greater_than
    ? 'more than '
    : visibility.is_less_than
      ? 'less than '
      : ''
  return `${qualifier}${visibility.statute_miles} SM`
}

function periodWind(period: BundlePeriod): string {
  let wind = period.wind
  if (wind === null) return '—'
  let gust = wind.gust_kt === null ? '' : ` gusting ${wind.gust_kt}`
  return `${wind.direction_deg ?? 'VRB'}° at ${wind.speed_kt} kt${gust}`
}

const crumbStyle = css({
  margin: '0 0 8px',
  '& a': { color: 'var(--ink-3)', textDecoration: 'none' },
  '& a:hover': { color: 'var(--ink-1)' },
})

const titleRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '16px',
  flexWrap: 'wrap',
})

const badgeStyle = css({
  padding: '4px 10px',
  borderRadius: '999px',
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.08em',
})

const metaStyle = css({
  margin: '8px 0 0',
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const staleStyle = css({
  marginInlineStart: '8px',
  padding: '1px 6px',
  border: '1px solid var(--accent)',
  borderRadius: '4px',
  color: 'var(--accent)',
})

const rawStyle = css({
  display: 'block',
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  background: 'var(--paper)',
  fontFamily: 'inherit',
  fontSize: '12px',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
})

const warningStyle = css({
  margin: '10px 0 0',
  padding: '8px 10px',
  borderInlineStart: '3px solid var(--accent)',
  background: 'var(--paper)',
  fontSize: '12px',
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))',
  gap: '10px 20px',
  margin: '14px 0 0',
})

const factStyle = css({
  margin: 0,
  '& dt': {
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
  },
  '& dd': { margin: 0 },
})

const basisStyle = css({
  margin: '12px 0 0',
  fontSize: '12px',
  color: 'var(--ink-2)',
})

const validityStyle = css({
  margin: '0 0 10px',
  fontSize: '12px',
  color: 'var(--ink-3)',
})

const tableStyle = css({
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '12px',
  '& th, & td': {
    padding: '6px 8px',
    textAlign: 'start',
    borderBlockEnd: '1px solid var(--line)',
    verticalAlign: 'top',
  },
  '& th': {
    fontSize: '11px',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
    fontWeight: 400,
  },
})

const advisoryListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  '& li': {
    display: 'grid',
    gridTemplateColumns: '5.5rem 1fr auto',
    gap: '10px',
    padding: '8px 0',
    borderBlockEnd: '1px solid var(--line)',
  },
})

const hazardStyle = css({
  fontWeight: 700,
  color: 'var(--accent)',
  letterSpacing: '0.06em',
})
