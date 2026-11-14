import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import type {
  AreaPayload,
  AreaStation,
  Bundle,
  BundleMetar,
} from '#app/lib/api-types.ts'
import type { Blend } from '#app/lib/public/blend.ts'
import { blendStations } from '#app/lib/public/blend.ts'
import { reportLabel } from '#app/lib/public/labels.ts'
import { ChevronIcon } from '#app/ui/public/icons.tsx'
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
    let collapsed = false
    let scroller: HTMLElement | undefined
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let exitPoint: AreaPoint | null = null
    let exitPayload: AreaPayload | null = null
    let exitThread: ThreadEntry[] = []
    let exitError: string | null = null
    let exitLoading = false

    function scrollToEnd(): void {
      if (session.areaThread.length === 0) return
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    }

    function restartFrom(index: number, question: string): void {
      let text = question.trim()
      if (text === '') return
      session.discardAreaFrom(index)
      void session.askArea(text)
    }

    session.addEventListener(
      'change',
      async () => {
        let open = session.area !== null

        if (open) {
          clearTimeout(closingTimer)
          closing = false
          exitPoint = session.area
          exitPayload = session.areaPayload
          exitThread = session.areaThread
          exitError = session.areaError
          exitLoading = session.areaLoading
          await handle.update()
          scrollToEnd()
          return
        }

        if (exitPoint === null || closing) {
          await handle.update()
          return
        }

        closing = true
        await handle.update()
        closingTimer = setTimeout(() => {
          closing = false
          exitPoint = null
          exitPayload = null
          exitThread = []
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
      let point = session.area ?? (closing ? exitPoint : null)
      if (point === null) return null

      let payload = closing ? exitPayload : session.areaPayload
      let stations = payload?.stations ?? []
      let brief = payload?.brief ?? null
      let error = closing ? exitError : session.areaError
      let loading = closing ? exitLoading : session.areaLoading
      let thread = closing ? exitThread : session.areaThread
      let blend = blendStations(
        stations.map((station) => ({
          distance_nm: station.distance_nm,
          metar:
            brief?.stations.find((item) => item.icao === station.icao)?.metar ??
            null,
        })),
      )

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
                  : `${stations.length} station${stations.length === 1 ? '' : 's'} within ${payload?.radius_nm ?? 15} nm`}
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

          {loading ? null : stations.length === 0 ? (
            <p mix={emptyStyle}>
              {error ??
                `No station within ${payload?.radius_nm ?? 15} nm of that ` +
                  'point. Pick a spot closer to one, or search by code.'}
            </p>
          ) : (
            <>
              <div
                aria-hidden={collapsed ? 'true' : 'false'}
                data-collapsed={collapsed ? 'true' : 'false'}
                mix={infoStyle}
              >
                {error === null ? null : <p mix={mutedStyle}>{error}</p>}

                {blend === null ? (
                  <p mix={mutedStyle}>
                    None of the stations in range has a report to blend.
                  </p>
                ) : (
                  <section aria-label="Blended conditions" mix={blendStyle}>
                    <span mix={blendKickerStyle}>Blended here</span>
                    <p mix={blendLineStyle}>{blendLine(blend)}</p>
                    <p mix={blendNoteStyle}>{blendNote(blend)}</p>
                  </section>
                )}

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
              </div>

              <div mix={dividerStyle}>
                <button
                  aria-expanded={!collapsed}
                  aria-label={collapsed ? 'Show stations' : 'Hide stations'}
                  mix={[
                    collapseStyle,
                    on('click', () => {
                      collapsed = !collapsed
                      handle.update()
                    }),
                  ]}
                  type="button"
                >
                  <span
                    aria-hidden="true"
                    mix={chevronStyle}
                    style={{ transform: `rotate(${collapsed ? 180 : 0}deg)` }}
                  >
                    <ChevronIcon />
                  </span>
                </button>
              </div>
            </>
          )}

          <div mix={[threadStyle, ref((node) => (scroller = node))]}>
            {thread.length === 0 ? (
              <p mix={hintStyle}>
                Ask about the weather here. Answers quote each station by name,
                while the summary above blends them for the point. Open a
                station for its forecast and history.
              </p>
            ) : (
              thread.map((entry, index) => (
                <div key={`${entry.question}-${index}`} mix={exchangeStyle}>
                  <UserTurn
                    onEdit={(next) => restartFrom(index, next)}
                    question={entry.question}
                  />
                  <AssistantTurn
                    entry={entry}
                    onRegenerate={() => {
                      let question = thread[index]?.question
                      if (question !== undefined) restartFrom(index, question)
                    }}
                    showName={index === 0}
                  />
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

  return reportLabel(metar)
}

function blendLine(blend: Blend): string {
  let parts: string[] = []

  if (blend.wind !== null) {
    let wind = `wind ${blend.wind.direction_deg}° at ${blend.wind.speed_kt} kt`
    if (blend.wind.gust_kt !== null)
      wind += `, gusting ${blend.wind.gust_kt} kt`
    parts.push(wind)
  }

  if (blend.visibility_sm !== null) {
    let { value, low, high } = blend.visibility_sm
    let range = low === high ? '' : ` (${low} to ${high})`
    parts.push(`visibility ${trim(value)} SM${range}`)
  }

  if (blend.ceiling_ft !== null) {
    parts.push(`ceiling ${blend.ceiling_ft.value.toLocaleString()} ft`)
  }

  if (blend.temperature_c !== null) {
    parts.push(`${blend.temperature_c.toFixed(1)} °C`)
  }

  if (blend.humidity_pct !== null) {
    parts.push(`humidity ${Math.round(blend.humidity_pct)}%`)
  }

  return parts.join(' · ')
}

function blendNote(blend: Blend): string {
  let parts = ['Distance-weighted']
  parts.push(
    blend.used === blend.total
      ? `from ${blend.used} report${blend.used === 1 ? '' : 's'}`
      : `from ${blend.used} of ${blend.total} reports`,
  )
  if (blend.distance_nm !== null) {
    parts.push(`nearest ${blend.distance_nm} nm`)
  }
  if (blend.ceiling_ft !== null && blend.ceiling_ft.reports < blend.used) {
    parts.push(`ceiling from ${blend.ceiling_ft.reports} of ${blend.used}`)
  }
  return `${parts.join(' · ')}. A summary, not an observation.`
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
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

/**
 * The blended summary sits still under the header, always in view: it is the
 * one line that answers "what is it like here". The chevron below it folds the
 * station list, which is the part that can run long.
 */
/**
 * The summary and its stations stay put while the thread scrolls under them.
 * The chevron folds the block to nothing, and the block scrolls inside a
 * capped height, giving way before the thread when the window is short. Its
 * scrollbar is hidden: the seam is the cue that there is more.
 */
const infoStyle = css({
  flex: '0 1 auto',
  minHeight: 0,
  maxHeight: 'min(360px, 55vh)',
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  padding: '20px',
  borderBlockEnd: '1px solid var(--line)',
  scrollbarWidth: 'none',
  transition:
    'max-height 220ms ease, padding 220ms ease, opacity 220ms ease, ' +
    'border-bottom-width 220ms ease',
  '&::-webkit-scrollbar': { display: 'none' },
  '&[data-collapsed="true"]': {
    maxHeight: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    borderBottomWidth: '0px',
    opacity: 0,
  },
})

/** A zero-height seam between the summary and the list, for the chevron. */
const dividerStyle = css({
  position: 'relative',
  height: 0,
  flexShrink: 0,
  zIndex: 1,
})

/** The whole seam is the button; the chevron is the handle on it. */
const collapseStyle = css({
  position: 'absolute',
  left: 0,
  right: 0,
  top: '-13px',
  height: '26px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  border: 'none',
  background: 'transparent',
  color: 'var(--ink-3)',
  cursor: 'pointer',
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '-2px',
  },
})

const chevronStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '26px',
  height: '26px',
  border: '1px solid var(--line)',
  borderRadius: '50%',
  background: 'var(--paper-2)',
  transition: 'transform 200ms ease, color 120ms ease',
  '&:hover': { color: 'var(--ink-0)' },
})

const threadStyle = css({
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

const blendStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  padding: '10px 12px',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  background: 'rgba(126, 199, 214, 0.08)',
})

const blendKickerStyle = css({
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const blendLineStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-0)',
})

const blendNoteStyle = css({
  margin: 0,
  fontSize: '11px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const mutedStyle = css({ margin: 0, fontSize: '12px', color: 'var(--ink-3)' })

/** A point with nothing in range needs a line, not a fold with nothing in it. */
const emptyStyle = css({
  flexShrink: 0,
  margin: 0,
  padding: '20px 20px 16px',
  fontSize: '12px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
  paddingBlockStart: '18px',
})
