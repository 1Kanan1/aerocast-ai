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
import { CloseIcon } from '#app/ui/public/icons.tsx'
import { prefersReducedMotion } from '#app/ui/public/motion.ts'
import { CategoryBadge, SegmentedTabs } from '#app/ui/public/primitives.tsx'
import type { AreaPoint, ThreadEntry } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'
import {
  AssistantTurn,
  ThreadAnnouncer,
  UserTurn,
} from '#app/ui/public/thread-parts.tsx'

type AreaSection = 'overview' | 'ask'

const PANEL_EXIT_MS = 180

/**
 * Area drawer for a clicked map point: segmented Overview (blended summary +
 * FAA-badged nearby station cards) and Ask sections.
 */
export const AreaPanel = clientEntry(
  import.meta.url,
  function AreaPanel(handle: Handle) {
    let activeSection: AreaSection = 'overview'
    let scroller: HTMLElement | undefined
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let exitPoint: AreaPoint | null = null
    let exitPayload: AreaPayload | null = null
    let exitThread: ThreadEntry[] = []
    let exitError: string | null = null
    let exitLoading = false
    let lastAreaTurns = 0

    function scrollToEnd(): void {
      if (session.areaThread.length === 0 || activeSection !== 'ask') return
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
          let turns = session.areaThread.length
          if (turns > lastAreaTurns) {
            activeSection = 'ask'
          } else if (turns === 0 && lastAreaTurns > 0) {
            activeSection = 'overview'
          }
          lastAreaTurns = turns
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
          lastAreaTurns = 0
          activeSection = 'overview'
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
            animation:
              closing && !prefersReducedMotion()
                ? 'rmx-panel-out 180ms ease-in forwards'
                : undefined,
            pointerEvents: closing ? 'none' : undefined,
          }}
        >
          <header mix={headerStyle}>
            <div mix={identityStyle}>
              <span mix={pointStyle}>{pointLabel(point.lat, point.lon)}</span>
              <span mix={countStyle}>
                {loading
                  ? 'Reading nearby stations…'
                  : `${stations.length} station${stations.length === 1 ? '' : 's'} within ${payload?.radius_nm ?? 15} nm`}
              </span>
            </div>
            <button
              aria-label="Close area"
              mix={[closeStyle, on('click', () => session.closeArea())]}
              type="button"
            >
              <CloseIcon />
            </button>
          </header>

          <div mix={tabsWrapStyle}>
            <SegmentedTabs<AreaSection>
              active={activeSection}
              onSelect={(next) => {
                activeSection = next
                handle.update()
              }}
              tabs={[
                { id: 'overview', label: 'Overview' },
                {
                  id: 'ask',
                  label: 'Ask',
                  badge: thread.length || undefined,
                },
              ]}
            />
          </div>

          <div mix={[bodyStyle, ref((node) => (scroller = node))]}>
            <ThreadAnnouncer thread={thread} />

            {activeSection === 'overview' ? (
              <div key="overview" mix={[tabPaneStyle, stackStyle]}>
                {loading ? (
                  <p mix={mutedStyle}>Reading nearby stations…</p>
                ) : error !== null ? (
                  <div mix={errorBoxStyle} role="alert">
                    <p mix={errorTextStyle}>{error}</p>
                    <button
                      mix={[
                        retryButtonStyle,
                        on('click', () => void session.retryArea()),
                      ]}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : stations.length === 0 ? (
                  <p mix={mutedStyle}>
                    No station within {payload?.radius_nm ?? 15} nm of that
                    point. Pick a spot closer to an airport or ask by code.
                  </p>
                ) : (
                  <>
                    {blend === null ? (
                      <p mix={mutedStyle}>
                        None of the nearby stations has a current report to
                        blend.
                      </p>
                    ) : (
                      <section aria-label="Blended conditions" mix={blendStyle}>
                        <p mix={blendLineStyle}>{blendLine(blend)}</p>
                        <p mix={blendNoteStyle}>{blendNote(blend)}</p>
                      </section>
                    )}

                    <div mix={sectionBlockStyle}>
                      <h3 mix={sectionHeadingStyle}>Nearby stations</h3>
                      <ul mix={listStyle}>
                        {stations.map((station) => {
                          let metar = stationMetar(station, brief)
                          let category = metar?.flight_category.value ?? null
                          return (
                            <li key={station.icao}>
                              <button
                                aria-label={`Open ${station.icao}`}
                                mix={[
                                  rowStyle,
                                  on(
                                    'click',
                                    () => void session.select(station.icao),
                                  ),
                                ]}
                                type="button"
                              >
                                <span mix={rowHeadStyle}>
                                  <span mix={codeStyle}>{station.icao}</span>
                                  <CategoryBadge
                                    category={category}
                                    size="sm"
                                  />
                                  <span mix={nameStyle}>{station.name}</span>
                                  <span mix={distanceStyle}>
                                    {station.distance_nm} nm
                                  </span>
                                </span>
                                <span mix={factsStyle}>
                                  {metar === null
                                    ? 'No observation on file'
                                    : reportLabel(metar)}
                                </span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div key="ask" mix={[tabPaneStyle, threadColumnStyle]}>
                {thread.length === 0 ? (
                  <p mix={mutedStyle}>
                    Ask about the weather here. Answers cite each nearby station
                    by name while Overview blends them for this point.
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
                          if (question !== undefined) {
                            restartFrom(index, question)
                          }
                        }}
                        showName={index === 0}
                      />
                    </div>
                  ))
                )}
              </div>
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

function stationMetar(
  station: AreaStation,
  brief: Bundle | null,
): BundleMetar | null {
  return (
    brief?.stations.find((item) => item.icao === station.icao)?.metar ?? null
  )
}

function blendLine(blend: Blend): string {
  let parts: string[] = []

  if (blend.wind !== null) {
    let wind = `Wind ${blend.wind.direction_deg}° at ${blend.wind.speed_kt} kt`
    if (blend.wind.gust_kt !== null) wind += ` G${blend.wind.gust_kt}`
    parts.push(wind)
  }

  if (blend.visibility_sm !== null) {
    let { value, low, high } = blend.visibility_sm
    let range = low === high ? '' : ` (${low}–${high})`
    parts.push(`Vis ${trim(value)} SM${range}`)
  }

  if (blend.ceiling_ft !== null) {
    parts.push(`Ceiling ~${blend.ceiling_ft.value.toLocaleString()} ft`)
  }

  if (blend.temperature_c !== null) {
    parts.push(`${blend.temperature_c.toFixed(1)} °C`)
  }

  if (blend.humidity_pct !== null) {
    parts.push(`RH ${Math.round(blend.humidity_pct)}%`)
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
  return `${parts.join(' · ')}. Summary only, not a direct observation.`
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
  width: 'min(500px, calc(100vw - 32px))',
  borderRadius: '20px',
  border: '1px solid var(--glass-border)',
  background: 'var(--paper-2)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
  transition:
    'background-color 220ms var(--ease-out), border-color 220ms var(--ease-out)',
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-panel-in 260ms var(--ease-out) both',
  },
  '@media (max-width: 900px)': { bottom: '120px' },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
  flexShrink: 0,
  padding: '14px 16px 12px',
  borderBlockEnd: '1px solid var(--line)',
})

const identityStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  minWidth: 0,
})

const pointStyle = css({
  fontFamily: 'var(--font-mono)',
  fontSize: '15px',
  fontWeight: 700,
  color: 'var(--ink-0)',
})

const countStyle = css({ fontSize: '12px', color: 'var(--ink-2)' })

const closeStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  flexShrink: 0,
  borderRadius: '999px',
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  transition:
    'background 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)', color: 'var(--ink-0)' },
  '&:active': { transform: 'scale(0.92)' },
})

const tabsWrapStyle = css({
  padding: '10px 16px 0',
  flexShrink: 0,
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '14px 16px 18px',
  scrollBehavior: 'smooth',
})

const tabPaneStyle = css({
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-tab-in 220ms var(--ease-out) both',
  },
})

const stackStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
})

const threadColumnStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
})

const sectionBlockStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const sectionHeadingStyle = css({
  margin: 0,
  fontSize: '13px',
  fontWeight: 600,
  color: 'var(--ink-2)',
})

const blendStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  padding: '12px 14px',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  background: 'var(--accent-soft)',
})

const blendLineStyle = css({
  margin: 0,
  fontSize: '14px',
  fontWeight: 600,
  lineHeight: 1.45,
  color: 'var(--ink-0)',
  fontVariantNumeric: 'tabular-nums',
})

const blendNoteStyle = css({
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
})

const listStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  margin: 0,
  padding: 0,
  listStyle: 'none',
})

const rowStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '5px',
  width: '100%',
  padding: '11px 12px',
  border: '1px solid var(--line)',
  borderRadius: '12px',
  background: 'var(--paper)',
  color: 'var(--ink-0)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  transition:
    'background 160ms var(--ease-out), border-color 160ms var(--ease-out), transform 160ms var(--ease-out)',
  '&:hover': {
    background: 'var(--hover-bg)',
    borderColor: 'var(--line-strong)',
    transform: 'translateY(-1px)',
  },
  '&:active': { transform: 'scale(0.99)' },
})

const rowHeadStyle = css({
  display: 'grid',
  gridTemplateColumns: 'auto auto minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: '8px',
})

const codeStyle = css({
  fontFamily: 'var(--font-mono)',
  fontSize: '13px',
  fontWeight: 700,
})

const nameStyle = css({
  minWidth: 0,
  fontSize: '13px',
  color: 'var(--ink-1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const distanceStyle = css({
  fontSize: '12px',
  color: 'var(--ink-3)',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
})

const factsStyle = css({
  fontSize: '12px',
  lineHeight: 1.45,
  color: 'var(--ink-2)',
})

const errorBoxStyle = css({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '12px',
  border: '1px solid var(--danger-border)',
  borderRadius: '10px',
  background: 'var(--danger-bg)',
})

const errorTextStyle = css({
  margin: 0,
  fontSize: '13px',
  color: 'var(--danger-ink)',
})

const retryButtonStyle = css({
  padding: '7px 14px',
  border: '1px solid var(--line-strong)',
  borderRadius: '8px',
  background: 'var(--paper-2)',
  color: 'var(--ink-0)',
  font: 'inherit',
  fontSize: '12px',
  fontWeight: 600,
  cursor: 'pointer',
  transition:
    'background 150ms var(--ease-out), transform 140ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)' },
  '&:active': { transform: 'scale(0.96)' },
})

const mutedStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})
