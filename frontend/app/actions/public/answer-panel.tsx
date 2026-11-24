import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import { ageLabel, timeLabel } from '#app/lib/format.ts'
import { decodedReport } from '#app/lib/observations.ts'
import {
  ceilingLabel,
  cloudsLabel,
  periodWindLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from '#app/lib/public/labels.ts'
import { conditionsAt } from '#app/lib/public/timeline.ts'
import { routes } from '#app/routes.ts'
import { CloseIcon } from '#app/ui/public/icons.tsx'
import {
  CategoryBadge,
  CollapsibleSection,
  DefinitionsDisclosure,
  FactGrid,
  type FactItem,
  RawReport,
  SegmentedTabs,
  TafTableCompact,
} from '#app/ui/public/primitives.tsx'
import type { Clarification, SelectedStation } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'
import {
  createSheetDragController,
  SHEET_HALF_VH,
  SHEET_PEEK_PX,
  type SheetSnap,
} from '#app/ui/public/sheet-drag.ts'
import {
  AssistantTurn,
  citationTarget,
  ClarificationView,
  type Suggestion,
  ThreadAnnouncer,
  ThreadWelcome,
  UserTurn,
} from '#app/ui/public/thread-parts.tsx'
import { weatherLayers } from '#app/ui/public/weather-layers.ts'

type Section = 'conditions' | 'forecast' | 'ask'

const PANEL_EXIT_MS = 180
const WHEN = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
})

const SUGGESTIONS: readonly Suggestion[] = [
  { prompt: 'What is the ceiling and visibility?' },
  { prompt: 'What is the wind doing?' },
  { prompt: 'What does the forecast say?' },
  { prompt: 'Are there any active advisories nearby?' },
]

/** The station drawer: segmented Conditions, Forecast, and Ask sections over the map. */
export const AnswerPanel = clientEntry(
  import.meta.url,
  function AnswerPanel(handle: Handle) {
    let panelEl: HTMLElement | undefined
    let scroller: HTMLElement | undefined
    let activeSection: Section = 'conditions'
    let snap: SheetSnap = 'half'
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let lastStation: SelectedStation | null = session.selected
    let lastClarification: Clarification | null = session.clarification
    let lastIcao: string | null = session.selected?.icao ?? null
    let lastTurns = session.selected?.thread.length ?? 0

    let drag = createSheetDragController({
      getPanel: () => panelEl,
      onSnap: (next) => {
        snap = next
        handle.update()
      },
      onDismiss: () => session.clear(),
      signal: handle.signal,
    })

    function scrollToEnd(): void {
      let station = session.selected
      if (station === null || station.thread.length === 0) return
      if (activeSection !== 'ask') return
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    }

    function restartFrom(index: number, question: string): void {
      let text = question.trim()
      if (text === '') return
      session.discardFrom(index)
      void session.ask(text)
    }

    function handleSelectCitation(refPath: string): void {
      let target = citationTarget(refPath)
      session.highlightRef(refPath)
      activeSection = target.section
      if (snap === 'peek') snap = 'half'
      handle.update()
    }

    function cycleSnap(): void {
      if (drag.consumeSuppressedClick()) return
      snap = snap === 'half' ? 'full' : snap === 'full' ? 'peek' : 'half'
      if (snap === 'peek') drag.syncPeekHeight()
      handle.update()
    }

    session.addEventListener(
      'change',
      async () => {
        if (session.selected === null && session.clarification === null) {
          if (closing) return
          if (lastStation === null && lastClarification === null) return

          closing = true
          await handle.update()
          closingTimer = setTimeout(() => {
            closing = false
            lastStation = null
            lastClarification = null
            lastIcao = null
            lastTurns = 0
            drag.resetInlineState()
            handle.update()
          }, PANEL_EXIT_MS)
          return
        }

        clearTimeout(closingTimer)
        closing = false
        let nextStation = session.selected
        let nextTurns = nextStation?.thread.length ?? 0
        if (nextStation !== null) {
          if (nextStation.icao !== lastIcao) {
            lastIcao = nextStation.icao
            lastTurns = nextTurns
            activeSection = nextTurns > 0 ? 'ask' : 'conditions'
            snap = 'half'
            drag.resetInlineState()
          } else if (nextTurns > lastTurns) {
            lastTurns = nextTurns
            activeSection = 'ask'
            if (snap === 'peek') snap = 'half'
          } else {
            lastTurns = nextTurns
          }
        } else if (session.clarification !== null) {
          activeSection = 'ask'
          snap = 'half'
          drag.resetInlineState()
        }

        lastStation = nextStation
        lastClarification = session.clarification
        await handle.update()
        scrollToEnd()
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape') return
          if (document.querySelector('[popover]:popover-open') !== null) return
          if (session.selected === null && session.clarification === null) {
            return
          }
          session.clear()
        },
        { signal: handle.signal },
      )
    })

    return () => {
      let station = session.selected ?? (closing ? lastStation : null)
      let clarification =
        session.clarification ?? (closing ? lastClarification : null)
      let open = station !== null || clarification !== null

      return (
        <aside
          aria-label="Answer"
          data-closing={closing ? 'true' : 'false'}
          data-elevated={snap === 'full' ? 'true' : 'false'}
          data-open={open ? 'true' : 'false'}
          data-snap={snap}
          mix={[panelStyle, ref((node) => (panelEl = node))]}
        >
          <button
            aria-label={
              snap === 'full'
                ? 'Collapse station sheet'
                : snap === 'peek'
                  ? 'Expand station sheet'
                  : 'Maximize station sheet'
            }
            mix={[
              sheetHandleStyle,
              on('pointerdown', (event) => drag.onPointerDown(event, true)),
              on('click', cycleSnap),
            ]}
            type="button"
          >
            <span aria-hidden="true" mix={sheetGripStyle} />
          </button>

          <header
            mix={[
              headerStyle,
              on('pointerdown', (event) => drag.onPointerDown(event, false)),
            ]}
          >
            <div mix={identityStyle}>
              <div mix={titleRowStyle}>
                <span mix={icaoStyle}>{station?.icao ?? 'AeroCast'}</span>
                {station !== null ? (
                  <CategoryBadge category={station.category} />
                ) : null}
              </div>
              <span mix={nameStyle}>
                {station?.name ?? 'Which station did you mean?'}
              </span>
            </div>
            <div mix={headerActionsStyle}>
              {station !== null ? (
                <a
                  href={routes.station.href({ icao: station.icao })}
                  key="full-page"
                  mix={fullPageStyle}
                >
                  Full page →
                </a>
              ) : null}
              <button
                aria-label="Close answers"
                key="close"
                mix={[closeStyle, on('click', () => session.clear())]}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          {station !== null ? (
            <div data-sheet-content mix={tabsWrapStyle}>
              <SegmentedTabs<Section>
                active={activeSection}
                onSelect={(next) => {
                  activeSection = next
                  if (snap === 'peek') snap = 'half'
                  handle.update()
                }}
                tabs={[
                  { id: 'conditions', label: 'Conditions' },
                  {
                    id: 'forecast',
                    label: 'Forecast',
                    badge: station.taf?.periods.length || undefined,
                  },
                  {
                    id: 'ask',
                    label: 'Ask',
                    badge: station.thread.length || undefined,
                  },
                ]}
              />
            </div>
          ) : null}

          <div
            data-sheet-content
            mix={[bodyStyle, ref((node) => (scroller = node))]}
          >
            {station === null ? null : (
              <ThreadAnnouncer thread={station.thread} />
            )}

            {clarification !== null ? (
              <div key="clarify" mix={tabPaneStyle}>
                <ClarificationView
                  message={clarification.message}
                  onChoose={(icao) => session.choose(icao)}
                  options={clarification.options}
                />
              </div>
            ) : station === null ? null : activeSection === 'conditions' ? (
              <div key="conditions" mix={tabPaneStyle}>
                <ConditionsSection
                  highlightedRef={session.highlightedRef}
                  station={station}
                />
              </div>
            ) : activeSection === 'forecast' ? (
              <div key="forecast" mix={tabPaneStyle}>
                {station.loading ? (
                  <p mix={mutedStyle}>Loading forecast…</p>
                ) : station.taf !== null ? (
                  <TafTableCompact
                    highlightedRef={session.highlightedRef}
                    source={station.source}
                    taf={station.taf}
                  />
                ) : (
                  <p mix={mutedStyle}>No TAF on file for {station.icao}.</p>
                )}
              </div>
            ) : (
              <div key="ask" mix={[tabPaneStyle, threadColumnStyle]}>
                {station.loading ? (
                  <p mix={mutedStyle}>Loading station facts…</p>
                ) : station.error !== null ? (
                  <div mix={errorBoxStyle} role="alert">
                    <p mix={errorTextStyle}>{station.error}</p>
                    <button
                      mix={[
                        retryButtonStyle,
                        on('click', () => void session.retryStation()),
                      ]}
                      type="button"
                    >
                      Retry
                    </button>
                  </div>
                ) : station.thread.length === 0 ? (
                  <ThreadWelcome
                    category={station.category}
                    disabled={false}
                    icao={station.icao}
                    name={station.name}
                    onAsk={(prompt) => void session.ask(prompt)}
                    suggestions={SUGGESTIONS}
                  />
                ) : (
                  station.thread.map((entry, index) => (
                    <div key={`${entry.question}-${index}`} mix={exchangeStyle}>
                      <UserTurn
                        onEdit={(next) => restartFrom(index, next)}
                        question={entry.question}
                      />
                      <AssistantTurn
                        entry={entry}
                        onRegenerate={() => {
                          let question = station.thread[index]?.question
                          if (question !== undefined) {
                            restartFrom(index, question)
                          }
                        }}
                        onSelectRef={handleSelectCitation}
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

function ConditionsSection(
  handle: Handle<{ highlightedRef: string | null; station: SelectedStation }>,
) {
  return () => {
    let { highlightedRef, station } = handle.props

    if (station.loading) {
      return <p mix={mutedStyle}>Loading station facts…</p>
    }

    if (station.error !== null) {
      return (
        <div mix={errorBoxStyle} role="alert">
          <p mix={errorTextStyle}>{station.error}</p>
          <button
            mix={[
              retryButtonStyle,
              on('click', () => void session.retryStation()),
            ]}
            type="button"
          >
            Retry
          </button>
        </div>
      )
    }

    if (station.facts === null) {
      return <p mix={mutedStyle}>No observation on file for {station.icao}.</p>
    }

    if (session.viewHour !== 0) {
      return <TimedConditions hour={session.viewHour} station={station} />
    }

    let facts = station.facts
    let highlightedField = highlightedRef
      ? citationTarget(highlightedRef).field
      : null
    let humidity = facts.humidity?.relative_pct ?? null
    let echo =
      weatherLayers.rain && session.echoShare !== null
        ? Math.round(session.echoShare * 100)
        : null

    let items: FactItem[] = [
      { key: 'wind', label: 'Wind', value: windLabel(facts) },
      { key: 'visibility', label: 'Visibility', value: visibilityLabel(facts) },
      { key: 'ceiling', label: 'Ceiling', value: ceilingLabel(facts) },
      { key: 'clouds', label: 'Clouds', value: cloudsLabel(facts) },
      {
        key: 'temperature',
        label: 'Temperature',
        value: temperatureLabel(facts),
      },
      {
        key: 'humidity',
        label: 'Humidity',
        value: humidity === null ? 'Not reported' : `${humidity}%`,
      },
      {
        key: 'altimeter',
        label: 'Altimeter',
        value:
          facts.altimeter_in_hg === null
            ? 'Not reported'
            : `${facts.altimeter_in_hg.toFixed(2)} inHg`,
      },
      {
        key: 'echo',
        label: 'Radar echo',
        value: echo === null ? 'Off / clear' : `${echo}% area`,
      },
    ]

    return (
      <div mix={stackStyle}>
        <p mix={provenanceStyle}>
          {station.source} · observed {timeLabel(facts.observed_at)} ·{' '}
          {ageLabel(station.ageSeconds)}
          {station.stale ? <span mix={stalePillStyle}>stale</span> : null}
        </p>

        {station.basis ? (
          <p
            data-highlighted={
              highlightedField === 'flight_category' ? 'true' : 'false'
            }
            mix={basisStyle}
          >
            {station.basis}
          </p>
        ) : null}

        {station.parseStatus !== null && station.parseStatus !== 'ok' ? (
          <p mix={warnBoxStyle}>
            Parser disagrees with AWC on this report
            {station.upstreamCategory
              ? ` (upstream ${station.upstreamCategory})`
              : ''}
            .
          </p>
        ) : null}

        <FactGrid highlightedKey={highlightedField} items={items} />

        {station.advisories.length > 0 ? (
          <CollapsibleSection
            forceOpen={highlightedField === 'advisories'}
            highlighted={highlightedField === 'advisories'}
            title={`Active advisories (${station.advisories.length})`}
          >
            <ul mix={advisoryListStyle}>
              {station.advisories.map((adv) => (
                <li key={adv.ref} mix={advisoryRowStyle}>
                  <span mix={advisoryHazardStyle}>{adv.hazard}</span>
                  <span mix={advisoryDetailStyle}>
                    {adv.kind.toUpperCase()}
                    {adv.due_to ? ` · ${adv.due_to}` : ''} · until{' '}
                    {timeLabel(adv.valid_to)}
                  </span>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        ) : null}

        {station.raw ? <RawReport raw={station.raw} /> : null}

        <DefinitionsDisclosure definitions={station.definitions} />
      </div>
    )
  }
}

function TimedConditions(
  handle: Handle<{ hour: number; station: SelectedStation }>,
) {
  return () => {
    let { hour, station } = handle.props
    let view = conditionsAt(station, hour, session.timelineBase)

    if (view.kind === 'no-report' || view.kind === 'no-forecast') {
      return (
        <div mix={stackStyle}>
          <p mix={mutedStyle}>
            {view.kind === 'no-report'
              ? 'No observation on file near this hour.'
              : 'The TAF does not cover this hour.'}
          </p>
          <button
            mix={[retryButtonStyle, on('click', () => session.setViewHour(0))]}
            type="button"
          >
            Back to live
          </button>
        </div>
      )
    }

    if (view.kind === 'report') {
      let report = decodedReport(view.point.decoded)
      let items: FactItem[] = [
        { key: 'wind', label: 'Wind', value: windLabel(report) },
        {
          key: 'visibility',
          label: 'Visibility',
          value: visibilityLabel(report),
        },
        { key: 'ceiling', label: 'Ceiling', value: ceilingLabel(report) },
        { key: 'clouds', label: 'Clouds', value: cloudsLabel(report) },
        {
          key: 'temperature',
          label: 'Temperature',
          value: temperatureLabel(report),
        },
      ]
      return (
        <div mix={stackStyle}>
          <div mix={timedHeadStyle}>
            <CategoryBadge category={view.point.category} size="sm" />
            <span mix={provenanceStyle}>
              Observed {WHEN.format(Date.parse(view.point.obs_time))}
            </span>
          </div>
          <FactGrid items={items} />
          <RawReport label="Observed METAR" raw={view.point.raw} />
        </div>
      )
    }

    let period = view.period
    let items: FactItem[] = [
      { key: 'wind', label: 'Wind', value: periodWindLabel(period) },
      {
        key: 'visibility',
        label: 'Visibility',
        value:
          period.visibility_sm === null ? '—' : `${period.visibility_sm} SM`,
      },
      {
        key: 'ceiling',
        label: 'Ceiling',
        value:
          period.ceiling_ft === null
            ? 'No ceiling'
            : `${period.ceiling_ft.toLocaleString()} ft`,
      },
      {
        key: 'weather',
        label: 'Weather',
        value: period.weather.join(' ') || 'None',
      },
    ]

    return (
      <div mix={stackStyle}>
        <p mix={provenanceStyle}>
          TAF {period.change} · {WHEN.format(Date.parse(period.from))} to{' '}
          {WHEN.format(Date.parse(period.to))}
        </p>
        <FactGrid items={items} />
      </div>
    )
  }
}

const panelStyle = css({
  position: 'absolute',
  top: '104px',
  right: '16px',
  bottom: '44px',
  zIndex: 4,
  display: 'none',
  flexDirection: 'column',
  width: 'min(500px, calc(100vw - 32px))',
  borderRadius: '20px',
  border: '1px solid var(--glass-border)',
  background: 'var(--paper-2)',
  boxShadow: 'var(--shadow)',
  overflow: 'hidden',
  transition:
    'background-color 220ms var(--ease-out), border-color 220ms var(--ease-out)',
  '&[data-open="true"]': {
    display: 'flex',
    '@media (prefers-reduced-motion: no-preference)': {
      animation: 'rmx-panel-in 260ms var(--ease-out) both',
    },
  },
  '&[data-closing="true"]': {
    display: 'flex',
    pointerEvents: 'none',
    '@media (prefers-reduced-motion: no-preference)': {
      animation: 'rmx-panel-out 180ms ease-in forwards',
    },
  },
  '@media (max-width: 900px)': {
    top: 'auto',
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    borderRadius: '20px 20px 0 0',
    borderInline: 0,
    borderBlockEnd: 0,
    transition:
      'height 320ms var(--ease-out), border-radius 240ms var(--ease-out), background-color 220ms var(--ease-out), border-color 220ms var(--ease-out)',
    '&[data-dragging="true"]': { transition: 'none' },
    '&[data-elevated="true"]': { zIndex: 7 },
    '&[data-edge-top="true"]': { borderRadius: 0 },
    '&[data-open="true"]': {
      '@media (prefers-reduced-motion: no-preference)': {
        animation: 'rmx-sheet-in 280ms var(--ease-out) both',
      },
    },
    '&[data-closing="true"]': {
      '@media (prefers-reduced-motion: no-preference)': {
        animation: 'rmx-sheet-out 200ms ease-in forwards',
      },
    },
    '&[data-snap="peek"]': {
      height: `var(--sheet-peek-h, ${SHEET_PEEK_PX}px)`,
    },
    '&[data-snap="peek"]:not([data-dragging="true"]) [data-sheet-content]': {
      opacity: 0,
      pointerEvents: 'none',
    },
    '&[data-snap="half"]': { height: `${SHEET_HALF_VH}dvh` },
    '&[data-snap="full"]': {
      height: '100dvh',
      borderRadius: 0,
      zIndex: 7,
      paddingBlockStart: 'env(safe-area-inset-top, 0px)',
    },
  },
})

const sheetHandleStyle = css({
  display: 'none',
  '@media (max-width: 900px)': {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    height: '28px',
    flexShrink: 0,
    border: 0,
    background: 'transparent',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
    '&:active': { cursor: 'grabbing' },
    '&:hover span': {
      background: 'var(--ink-2)',
      width: '48px',
    },
  },
})

const sheetGripStyle = css({
  width: '38px',
  height: '4px',
  borderRadius: '999px',
  background: 'var(--line-strong)',
  transition:
    'background-color 150ms var(--ease-out), width 180ms var(--ease-out)',
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '10px',
  flexShrink: 0,
  padding: '14px 16px 12px',
  borderBlockEnd: '1px solid var(--line)',
  '@media (max-width: 900px)': {
    paddingBlockStart: '4px',
    cursor: 'grab',
    touchAction: 'none',
    userSelect: 'none',
  },
})

const identityStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  minWidth: 0,
})

const titleRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
})

const icaoStyle = css({
  fontFamily: 'var(--font-mono)',
  fontSize: '16px',
  fontWeight: 700,
  color: 'var(--ink-0)',
})

const nameStyle = css({
  fontSize: '12px',
  color: 'var(--ink-2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const headerActionsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  flexShrink: 0,
})

const fullPageStyle = css({
  padding: '6px 9px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  color: 'var(--ink-2)',
  fontSize: '12px',
  fontWeight: 500,
  textDecoration: 'none',
  whiteSpace: 'nowrap',
  transition: 'background 160ms var(--ease-out), color 160ms var(--ease-out)',
  '&:hover': { background: 'var(--hover-bg)', color: 'var(--ink-0)' },
})

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
  // On mobile viewports the bottom sheet dismisses by dragging downward.
  '@media (max-width: 900px)': { display: 'none' },
})

const tabsWrapStyle = css({
  padding: '10px 16px 0',
  flexShrink: 0,
  transition: 'opacity 160ms var(--ease-out)',
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  padding: '14px 16px 18px',
  scrollBehavior: 'smooth',
  transition: 'opacity 160ms var(--ease-out)',
  '@media (max-width: 900px)': { paddingBlockEnd: '96px' },
})

const tabPaneStyle = css({
  '@media (prefers-reduced-motion: no-preference)': {
    animation: 'rmx-tab-in 220ms var(--ease-out) both',
  },
})

const stackStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
})

const threadColumnStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '14px',
})

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const provenanceStyle = css({
  margin: 0,
  fontSize: '12px',
  color: 'var(--ink-2)',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '6px',
})

const stalePillStyle = css({
  padding: '1px 6px',
  borderRadius: '4px',
  background: 'var(--warn-bg)',
  border: '1px solid var(--warn-border)',
  color: 'var(--warn-ink)',
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
})

const basisStyle = css({
  margin: 0,
  padding: '7px 10px',
  borderRadius: '8px',
  background: 'var(--paper)',
  fontSize: '12px',
  color: 'var(--ink-1)',
  transition: 'background-color 200ms var(--ease-out)',
  '&[data-highlighted="true"]': {
    outline: '2px solid var(--accent)',
    background: 'var(--accent-soft)',
  },
})

const warnBoxStyle = css({
  margin: 0,
  padding: '8px 10px',
  border: '1px solid var(--warn-border)',
  borderRadius: '8px',
  background: 'var(--warn-bg)',
  color: 'var(--warn-ink)',
  fontSize: '12px',
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

const advisoryListStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: '8px 0 0',
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
})

const advisoryRowStyle = css({
  display: 'flex',
  alignItems: 'baseline',
  gap: '8px',
  padding: '8px 10px',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  background: 'var(--paper-2)',
  fontSize: '12px',
})

const advisoryHazardStyle = css({
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  color: 'var(--warn-ink)',
})

const advisoryDetailStyle = css({
  color: 'var(--ink-2)',
  fontSize: '12px',
})

const timedHeadStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
})

const mutedStyle = css({
  margin: 0,
  fontSize: '13px',
  lineHeight: 1.5,
  color: 'var(--ink-2)',
})
