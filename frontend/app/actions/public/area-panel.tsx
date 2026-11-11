import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import type {
  AreaPayload,
  AreaStation,
  Bundle,
  BundleMetar,
} from '#app/lib/api-types.ts'
import { ageLabel } from '#app/lib/format.ts'
import {
  ceilingLabel,
  visibilityLabel,
  windLabel,
} from '#app/lib/public/labels.ts'
import type { AreaPoint, ThreadEntry } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'
import { AssistantTurn, UserTurn } from '#app/ui/public/thread-parts.tsx'

/** How long the panel takes to leave, matching rmx-card-out. */
const PANEL_EXIT_MS = 160

/**
 * A click on the map is a question about a place. This panel answers it with
 * the stations around that point, each one still speaking for itself, and a
 * thread that may use all of them.
 */
export const AreaPanel = clientEntry(
  import.meta.url,
  function AreaPanel(handle: Handle) {
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    // The last live snapshot, kept so the exit animation has contents.
    let lastPoint: AreaPoint | null = null
    let lastPayload: AreaPayload | null = null
    let lastThread: ThreadEntry[] = []
    let lastError: string | null = null
    let lastLoading = false

    session.addEventListener(
      'change',
      async () => {
        let open = session.area !== null

        if (open) {
          clearTimeout(closingTimer)
          closing = false
          lastPoint = session.area
          lastPayload = session.areaPayload
          lastThread = session.areaThread
          lastError = session.areaError
          lastLoading = session.areaLoading
          await handle.update()
          return
        }

        if (lastPoint === null || closing) {
          await handle.update()
          return
        }

        closing = true
        await handle.update()
        closingTimer = setTimeout(() => {
          closing = false
          lastPoint = null
          lastPayload = null
          lastThread = []
          handle.update()
        }, PANEL_EXIT_MS)
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape' || session.area === null) return
          if (document.querySelector('[popover]:popover-open') !== null) return
          session.closeArea()
        },
        { signal: handle.signal },
      )
    })

    return () => {
      let point = session.area ?? (closing ? lastPoint : null)
      if (point === null) return null

      let payload = closing ? lastPayload : session.areaPayload
      let stations = payload?.stations ?? []
      let brief = payload?.brief ?? null
      let error = closing ? lastError : session.areaError
      let loading = closing ? lastLoading : session.areaLoading
      let thread = closing ? lastThread : session.areaThread

      return (
        <aside
          aria-label="Weather here"
          mix={panelStyle}
          style={{
            animation: closing
              ? 'rmx-card-out 160ms ease-in forwards'
              : undefined,
            pointerEvents: closing ? 'none' : undefined,
          }}
        >
          <header mix={headerStyle}>
            <div mix={identityStyle}>
              <span mix={kickerStyle}>Weather here</span>
              <span mix={pointStyle}>{pointLabel(point.lat, point.lon)}</span>
              <span mix={countStyle}>
                {loading
                  ? 'reading the nearest stations…'
                  : `${stations.length} station${stations.length === 1 ? '' : 's'} within ${payload?.radius_nm ?? 30} nm`}
              </span>
            </div>
            <button
              aria-label="Close area"
              mix={[closeStyle, on('click', () => session.closeArea())]}
              type="button"
            >
              ×
            </button>
          </header>

          <div mix={bodyStyle}>
            {error === null ? null : <p mix={mutedStyle}>{error}</p>}

            {loading || error !== null ? null : stations.length === 0 ? (
              <p mix={mutedStyle}>
                No station within 30 nm of that point. Pick a spot closer to
                one, or search by code.
              </p>
            ) : (
              <ul mix={listStyle}>
                {stations.map((station) => (
                  <li key={station.icao}>
                    <button
                      aria-label={`Open ${station.icao}`}
                      mix={[
                        rowStyle,
                        on('click', () => void session.select(station.icao)),
                      ]}
                      type="button"
                    >
                      <span mix={rowHeadStyle}>
                        <span mix={codeStyle}>{station.icao}</span>
                        <span mix={nameStyle}>{station.name}</span>
                        <span mix={distanceStyle}>
                          {station.distance_nm} nm
                        </span>
                      </span>
                      <span mix={factsStyle}>
                        {stationFacts(station, brief)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {thread.length === 0 ? (
              <p mix={hintStyle}>
                Ask about the weather here. Answers name the station behind each
                number instead of blending them.
              </p>
            ) : (
              thread.map((entry, index) => (
                <div key={`${entry.question}-${index}`} mix={exchangeStyle}>
                  <UserTurn question={entry.question} />
                  <AssistantTurn entry={entry} showName={index === 0} />
                </div>
              ))
            )}
          </div>
        </aside>
      )
    }
  },
)

function pointLabel(lat: number, lon: number): string {
  let north = lat >= 0 ? 'N' : 'S'
  let east = lon >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(2)}°${north} ${Math.abs(lon).toFixed(2)}°${east}`
}

function stationFacts(station: AreaStation, brief: Bundle | null): string {
  let metar: BundleMetar | null =
    brief?.stations.find((item) => item.icao === station.icao)?.metar ?? null
  if (metar === null) return 'no observation on file'

  return [
    metar.flight_category.value ?? 'no category',
    windLabel(metar),
    visibilityLabel(metar),
    ceilingLabel(metar),
    ageLabel(metar.age_seconds),
  ].join(' · ')
}

const panelStyle = css({
  position: 'absolute',
  top: '104px',
  right: '16px',
  bottom: '44px',
  zIndex: 4,
  display: 'flex',
  flexDirection: 'column',
  width: 'min(520px, calc(100vw - 32px))',
  borderRadius: '20px',
  border: '1px solid var(--line)',
  background: 'var(--paper-2)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
  animation: 'rmx-card-in 200ms ease-out',
  '@media (max-width: 900px)': { bottom: '120px' },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
  flexShrink: 0,
  padding: '14px 20px',
  borderBlockEnd: '1px solid var(--line)',
})

const identityStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
})

const kickerStyle = css({
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const pointStyle = css({ fontWeight: 700 })

const countStyle = css({ fontSize: '11px', color: 'var(--ink-3)' })

const closeStyle = css({
  width: '28px',
  height: '28px',
  flexShrink: 0,
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'transparent',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-0)' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '20px',
  scrollBehavior: 'smooth',
})

const listStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  margin: 0,
  padding: 0,
  listStyle: 'none',
})

const rowStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '10px',
  background: 'rgba(255, 255, 255, 0.02)',
  color: 'var(--ink-0)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { background: 'rgba(255, 255, 255, 0.06)' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '1px',
  },
})

const rowHeadStyle = css({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'baseline',
  gap: '8px',
})

const codeStyle = css({ fontSize: '12px', fontWeight: 700 })
const nameStyle = css({
  minWidth: 0,
  fontSize: '12px',
  color: 'var(--ink-2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})
const distanceStyle = css({
  fontSize: '10px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
})
const factsStyle = css({
  fontSize: '11px',
  lineHeight: 1.45,
  color: 'var(--ink-3)',
})

const hintStyle = css({
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const mutedStyle = css({ margin: 0, fontSize: '12px', color: 'var(--ink-3)' })

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingBlockStart: '18px',
})
