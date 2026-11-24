import type { Handle } from 'remix/component'
import { css, on } from 'remix/component'

import type { BundlePeriod, BundleTaf } from '#app/lib/api-types.ts'
import { timeLabel, windowLabel } from '#app/lib/format.ts'
import { CATEGORY_SHADES, categoryInk } from '#app/lib/public/categories.ts'
import { periodWindLabel } from '#app/lib/public/labels.ts'
import { CheckIcon, ChevronIcon, CopyIcon } from '#app/ui/public/icons.tsx'

export interface FactItem {
  key: string
  label: string
  value: string
}

export interface TabOption<Id extends string> {
  badge?: number
  id: Id
  label: string
}

/** FAA flight-category pill using semantic CSS variables. */
export function CategoryBadge(
  handle: Handle<{ category: string | null; size?: 'sm' | 'md' }>,
) {
  return () => {
    let { category, size = 'md' } = handle.props
    let shade = category === null ? undefined : CATEGORY_SHADES[category]

    return (
      <span
        data-size={size}
        mix={badgeStyle}
        style={{
          background: shade ?? 'var(--paper-3)',
          color: shade ? categoryInk(category) : 'var(--ink-2)',
        }}
      >
        {category ?? 'No data'}
      </span>
    )
  }
}

/** Segmented section bar with a smoothly sliding active indicator pill. */
export function SegmentedTabs<Id extends string>(
  handle: Handle<{
    active: Id
    onSelect: (id: Id) => void
    tabs: readonly TabOption<Id>[]
  }>,
) {
  return () => {
    let { active, onSelect, tabs } = handle.props
    let count = Math.max(1, tabs.length)
    let activeIndex = Math.max(
      0,
      tabs.findIndex((tab) => tab.id === active),
    )

    return (
      <div
        mix={segmentedStyle}
        role="tablist"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden="true"
          mix={sliderPillStyle}
          style={{
            width: `calc((100% - 8px) / ${count})`,
            transform: `translateX(${activeIndex * 100}%)`,
          }}
        />
        {tabs.map((tab) => {
          let isSelected = tab.id === active
          return (
            <button
              aria-selected={isSelected ? 'true' : 'false'}
              data-active={isSelected ? 'true' : 'false'}
              key={tab.id}
              mix={[segmentButtonStyle, on('click', () => onSelect(tab.id))]}
              role="tab"
              type="button"
            >
              <span>{tab.label}</span>
              {tab.badge ? <span mix={tabBadgeStyle}>{tab.badge}</span> : null}
            </button>
          )
        })}
      </div>
    )
  }
}

/** Two-column decoded weather fact grid with smooth citation highlight pulse. */
export function FactGrid(
  handle: Handle<{
    highlightedKey?: string | null
    items: readonly FactItem[]
  }>,
) {
  return () => {
    let { highlightedKey = null, items } = handle.props

    return (
      <dl mix={factsGridStyle}>
        {items.map((item) => (
          <div
            data-highlighted={
              highlightedKey !== null && highlightedKey === item.key
                ? 'true'
                : 'false'
            }
            key={item.key}
            mix={factCardStyle}
          >
            <dt mix={factLabelStyle}>{item.label}</dt>
            <dd mix={factValueStyle}>{item.value}</dd>
          </div>
        ))}
      </dl>
    )
  }
}

/** Raw METAR/TAF string in monospace with a one-click copy action. */
export function RawReport(handle: Handle<{ raw: string; label?: string }>) {
  let copied = false
  let timer: ReturnType<typeof setTimeout> | undefined

  handle.signal.addEventListener('abort', () => clearTimeout(timer), {
    once: true,
  })

  async function copyRaw(): Promise<void> {
    try {
      await navigator.clipboard.writeText(handle.props.raw)
    } catch {
      return
    }
    copied = true
    handle.update()
    clearTimeout(timer)
    timer = setTimeout(() => {
      copied = false
      handle.update()
    }, 1500)
  }

  return () => (
    <div mix={rawWrapStyle}>
      <div mix={rawHeaderStyle}>
        <span mix={rawLabelStyle}>{handle.props.label ?? 'Raw METAR'}</span>
        <button
          aria-label={copied ? 'Copied raw report' : 'Copy raw report'}
          mix={[rawCopyStyle, on('click', () => void copyRaw())]}
          type="button"
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <code mix={rawCodeStyle}>{handle.props.raw}</code>
    </div>
  )
}

/** Scrollable TAF period table with sub-VFR row highlighting and citation match. */
export function TafTableCompact(
  handle: Handle<{
    highlightedRef?: string | null
    source: string
    taf: BundleTaf
  }>,
) {
  return () => {
    let { highlightedRef = null, source, taf } = handle.props

    return (
      <div mix={tafWrapStyle}>
        <div mix={tafScrollStyle}>
          <table mix={tafTableStyle}>
            <thead>
              <tr>
                <th>Window</th>
                <th>Type</th>
                <th>Wind</th>
                <th>Vis</th>
                <th>Ceiling</th>
                <th>Wx</th>
              </tr>
            </thead>
            <tbody>
              {taf.periods.map((period) => {
                let tier = tafRowTier(period)
                let cited = highlightedRef === period.ref
                return (
                  <tr
                    data-cited={cited ? 'true' : 'false'}
                    data-tier={tier}
                    key={period.ref}
                  >
                    <td mix={monoCellStyle}>
                      {windowLabel(period.from, period.to)}
                    </td>
                    <td mix={monoCellStyle}>
                      {period.probability
                        ? `${period.change} ${period.probability}%`
                        : period.change}
                    </td>
                    <td mix={monoCellStyle}>{periodWindLabel(period)}</td>
                    <td mix={monoCellStyle}>
                      {period.visibility_sm === null
                        ? '—'
                        : `${period.visibility_sm} SM`}
                    </td>
                    <td mix={monoCellStyle}>
                      {period.ceiling_ft === null
                        ? '—'
                        : `${period.ceiling_ft.toLocaleString()} ft`}
                    </td>
                    <td>{period.weather.join(' ') || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p mix={tafMetaStyle}>
          TAF from {source} · issued {timeLabel(taf.issued_at)}
        </p>
      </div>
    )
  }
}

/**
 * Animated collapsible Aviation terms glossary for client islands.
 * Uses CSS grid-template-rows 0fr -> 1fr so height glides smoothly.
 */
export function DefinitionsDisclosure(
  handle: Handle<{ definitions: Record<string, string> }>,
) {
  let open = false

  return () => {
    let entries = Object.entries(handle.props.definitions)
    if (entries.length === 0) return null

    return (
      <div data-open={open ? 'true' : 'false'} mix={definitionsWrapStyle}>
        <button
          aria-expanded={open ? 'true' : 'false'}
          mix={[
            definitionsTriggerStyle,
            on('click', () => {
              open = !open
              handle.update()
            }),
          ]}
          type="button"
        >
          <span>Aviation terms ({entries.length})</span>
          <span
            aria-hidden="true"
            mix={definitionsChevronStyle}
            style={{ transform: `rotate(${open ? 0 : 180}deg)` }}
          >
            <ChevronIcon />
          </span>
        </button>
        <div
          aria-hidden={!open}
          data-open={open ? 'true' : 'false'}
          mix={definitionsCollapseStyle}
        >
          <div mix={definitionsInnerStyle}>
            <dl mix={definitionsListStyle}>
              {entries.map(([term, description]) => (
                <div key={term} mix={definitionRowStyle}>
                  <dt mix={definitionTermStyle}>{term.replace(/_/g, ' ')}</dt>
                  <dd mix={definitionDescStyle}>{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    )
  }
}

/** Zero-JS native `<details>` version of Aviation terms for SSR pages. */
export function StaticDefinitionsDisclosure(
  handle: Handle<{ definitions: Record<string, string> }>,
) {
  return () => {
    let entries = Object.entries(handle.props.definitions)
    if (entries.length === 0) return null

    return (
      <details mix={definitionsWrapStyle}>
        <summary mix={staticSummaryStyle}>
          Aviation terms ({entries.length})
        </summary>
        <dl mix={definitionsListStyle}>
          {entries.map(([term, description]) => (
            <div key={term} mix={definitionRowStyle}>
              <dt mix={definitionTermStyle}>{term.replace(/_/g, ' ')}</dt>
              <dd mix={definitionDescStyle}>{description}</dd>
            </div>
          ))}
        </dl>
      </details>
    )
  }
}

function tafRowTier(period: BundlePeriod): 'severe' | 'marginal' | 'clear' {
  let ceil = period.ceiling_ft
  let vis = period.visibility_sm
  if ((ceil !== null && ceil < 1000) || (vis !== null && vis < 3)) {
    return 'severe'
  }
  if ((ceil !== null && ceil <= 3000) || (vis !== null && vis <= 5)) {
    return 'marginal'
  }
  return 'clear'
}

const badgeStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '3px 9px',
  borderRadius: '999px',
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.05em',
  lineHeight: 1.2,
  whiteSpace: 'nowrap',
  transition:
    'background-color 200ms var(--ease-out), color 200ms var(--ease-out)',
  '&[data-size="sm"]': {
    padding: '2px 7px',
    fontSize: '10px',
  },
})

const segmentedStyle = css({
  position: 'relative',
  display: 'grid',
  padding: '4px',
  borderRadius: '11px',
  border: '1px solid var(--line)',
  background: 'var(--paper)',
})

const sliderPillStyle = css({
  position: 'absolute',
  top: '4px',
  bottom: '4px',
  left: '4px',
  borderRadius: '8px',
  background: 'var(--paper-3)',
  border: '1px solid var(--line)',
  pointerEvents: 'none',
  transition: 'transform 260ms var(--ease-out)',
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

const segmentButtonStyle = css({
  position: 'relative',
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  minHeight: '32px',
  padding: '0 10px',
  border: 0,
  borderRadius: '8px',
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 500,
  cursor: 'pointer',
  transition: 'color 180ms var(--ease-out)',
  '&:hover': { color: 'var(--ink-0)' },
  '&[data-active="true"]': {
    color: 'var(--ink-0)',
    fontWeight: 600,
  },
})

const tabBadgeStyle = css({
  padding: '1px 6px',
  borderRadius: '999px',
  background: 'var(--accent-soft)',
  color: 'var(--accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '10px',
  fontWeight: 600,
})

const factsGridStyle = css({
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: '8px',
  margin: 0,
})

const factCardStyle = css({
  margin: 0,
  padding: '9px 11px',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
  transition:
    'border-color 200ms var(--ease-out), background-color 200ms var(--ease-out), transform 180ms var(--ease-out)',
  '&[data-highlighted="true"]': {
    borderColor: 'var(--accent)',
    background: 'var(--accent-soft)',
    '@media (prefers-reduced-motion: no-preference)': {
      animation: 'rmx-highlight-pulse 700ms var(--ease-out)',
    },
  },
})

const factLabelStyle = css({
  fontSize: '11px',
  fontWeight: 500,
  color: 'var(--ink-3)',
  marginBlockEnd: '2px',
})

const factValueStyle = css({
  margin: 0,
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--ink-0)',
  fontVariantNumeric: 'tabular-nums',
  overflowWrap: 'anywhere',
})

const rawWrapStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
  overflow: 'hidden',
})

const rawHeaderStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '6px 10px',
  borderBlockEnd: '1px solid var(--line)',
})

const rawLabelStyle = css({
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--ink-2)',
})

const rawCopyStyle = css({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  padding: '4px 8px',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
  transition:
    'background 160ms var(--ease-out), color 160ms var(--ease-out), transform 140ms var(--ease-out)',
  '& svg': { width: '13px', height: '13px' },
  '&:hover': { background: 'var(--hover-bg)', color: 'var(--ink-0)' },
  '&:active': { transform: 'scale(0.95)' },
})

const rawCodeStyle = css({
  display: 'block',
  padding: '10px',
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-1)',
  overflowWrap: 'anywhere',
})

const tafWrapStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const tafScrollStyle = css({
  overflowX: 'auto',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
})

const tafTableStyle = css({
  width: '100%',
  minWidth: '380px',
  borderCollapse: 'collapse',
  fontSize: '12px',
  '& th': {
    padding: '7px 8px',
    borderBlockEnd: '1px solid var(--line)',
    color: 'var(--ink-3)',
    fontWeight: 600,
    fontSize: '11px',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  },
  '& td': {
    padding: '7px 8px',
    borderBlockEnd: '1px solid var(--line)',
    color: 'var(--ink-1)',
    verticalAlign: 'top',
  },
  '& tbody tr:last-child td': { borderBlockEnd: 0 },
  '& tbody tr[data-tier="severe"]': { background: 'var(--danger-bg)' },
  '& tbody tr[data-tier="marginal"]': { background: 'var(--warn-bg)' },
  '& tbody tr[data-cited="true"]': {
    outline: '2px solid var(--accent)',
    outlineOffset: '-2px',
  },
})

const monoCellStyle = css({
  fontFamily: 'var(--font-mono)',
  fontSize: '11px',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
})

const tafMetaStyle = css({
  margin: 0,
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const definitionsWrapStyle = css({
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'var(--paper)',
  overflow: 'hidden',
  transition: 'border-color 180ms var(--ease-out)',
  '&[data-open="true"]': { borderColor: 'var(--line-strong)' },
})

const definitionsTriggerStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  width: '100%',
  padding: '10px 12px',
  border: 0,
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  textAlign: 'left',
  cursor: 'pointer',
  transition: 'color 160ms var(--ease-out), background 160ms var(--ease-out)',
  '&:hover': { color: 'var(--ink-0)', background: 'var(--hover-bg)' },
})

const definitionsChevronStyle = css({
  display: 'grid',
  placeItems: 'center',
  transition: 'transform 240ms var(--ease-out)',
})

const definitionsCollapseStyle = css({
  display: 'grid',
  gridTemplateRows: '0fr',
  opacity: 0,
  transition:
    'grid-template-rows 260ms var(--ease-out), opacity 220ms var(--ease-out)',
  '&[data-open="true"]': {
    gridTemplateRows: '1fr',
    opacity: 1,
  },
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
})

const definitionsInnerStyle = css({
  overflow: 'hidden',
})

const staticSummaryStyle = css({
  padding: '10px 12px',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--ink-2)',
  cursor: 'pointer',
  userSelect: 'none',
  '&:hover': { color: 'var(--ink-0)' },
})

const definitionsListStyle = css({
  margin: 0,
  padding: '0 12px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  borderBlockStart: '1px solid var(--line)',
})

const definitionRowStyle = css({
  paddingBlockStart: '8px',
})

const definitionTermStyle = css({
  fontFamily: 'var(--font-mono)',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--ink-0)',
})

const definitionDescStyle = css({
  margin: '2px 0 0',
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
})
