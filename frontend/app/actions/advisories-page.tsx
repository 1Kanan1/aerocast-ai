import type { Handle } from 'remix/component'
import { css } from 'remix/component'

import type { Advisory, AdvisoryList } from '#app/lib/api-types.ts'
import type { ApiResult } from '#app/lib/api.ts'
import { timeLabel, windowLabel } from '#app/lib/format.ts'
import {
  cardStyle,
  headingStyle,
  mutedStyle,
  Page,
  subheadingStyle,
} from '#app/ui/layout.tsx'

export function AdvisoriesPage(
  handle: Handle<{ advisories: ApiResult<AdvisoryList> }>,
) {
  return () => {
    let { advisories } = handle.props
    let rows = advisories.data?.data ?? []
    let groups = groupByHazard(rows)

    return (
      <Page active="advisories">
        <section>
          <h1 mix={headingStyle}>Active advisories</h1>
          <p mix={ledeStyle}>
            G-AIRMETs and SIGMETs currently in force over the United States.
            Advisories past their end time are not listed.
          </p>
          <p mix={mutedStyle}>{rows.length} active · aviationweather.gov</p>
        </section>

        {!advisories.ok ? (
          <p mix={mutedStyle}>
            The API is unavailable right now, so advisories cannot be listed.
          </p>
        ) : rows.length === 0 ? (
          <p mix={mutedStyle}>No active advisories are on file.</p>
        ) : (
          [...groups.entries()].map(([hazard, items]) => (
            <section key={hazard} aria-labelledby={`hazard-${hazard}`}>
              <h2 id={`hazard-${hazard}`} mix={subheadingStyle}>
                {hazard}
              </h2>
              <ul mix={listStyle}>
                {items.map((advisory) => (
                  <li key={`${advisory.kind}-${advisory.source_id}`}>
                    <AdvisoryRow advisory={advisory} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </Page>
    )
  }
}

function AdvisoryRow(handle: Handle<{ advisory: Advisory }>) {
  return () => {
    let { advisory } = handle.props

    return (
      <div mix={cardStyle}>
        <div mix={rowHeaderStyle}>
          <span mix={kindStyle}>
            {advisory.kind.toUpperCase()} {advisory.source_id}
          </span>
          <span mix={mutedStyle}>
            {windowLabel(advisory.valid_from, advisory.valid_to)}
          </span>
        </div>
        <p mix={detailStyle}>
          {advisory.due_to ?? 'No stated cause'}
          {advisory.severity ? ` · ${advisory.severity}` : ''}
        </p>
        <p mix={mutedStyle}>
          {advisory.base_ft === null && advisory.top_ft === null
            ? 'No altitude band reported'
            : `From ${advisory.base_ft?.toLocaleString() ?? 'surface'} ft to ${advisory.top_ft?.toLocaleString() ?? 'unstated'} ft`}
          {' · expires '}
          {timeLabel(advisory.valid_to)}
        </p>
      </div>
    )
  }
}

function groupByHazard(rows: Advisory[]): Map<string, Advisory[]> {
  let groups = new Map<string, Advisory[]>()

  for (let row of rows) {
    let items = groups.get(row.hazard)
    if (items) items.push(row)
    else groups.set(row.hazard, [row])
  }

  return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

const ledeStyle = css({
  margin: '0 0 8px',
  maxWidth: '62ch',
  color: 'var(--ink-2)',
})

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const rowHeaderStyle = css({
  display: 'flex',
  justifyContent: 'space-between',
  gap: '12px',
  flexWrap: 'wrap',
  alignItems: 'baseline',
})

const kindStyle = css({ fontWeight: 700 })

const detailStyle = css({ margin: '8px 0 4px' })
