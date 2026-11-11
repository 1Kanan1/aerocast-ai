import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import { ageLabel } from '#app/lib/format.ts'
import { humidityPercent } from '#app/lib/radar.ts'
import type { SelectedStation } from '#app/ui/public/session.ts'
import { type Anchor, session } from '#app/ui/public/session.ts'
import { weatherLayers } from '#app/ui/public/weather-layers.ts'

const CARD_GAP = 16
const CARD_PAD = 12
const NAVBAR_FLOOR = 84
const CARD_EXIT_MS = 160

/** The ask-first station card: who it is, the wind, and one way to ask. */
export const StationPopup = clientEntry(
  import.meta.url,
  function StationPopup(handle: Handle) {
    let host: HTMLElement | undefined
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let last: SelectedStation | null = null

    function place(anchor: Anchor | null): void {
      if (!host || anchor === null || !host.parentElement) return

      let bounds = host.parentElement.getBoundingClientRect()
      // The answer panel takes the right edge; keep the card clear of it.
      let panel = host.parentElement.querySelector<HTMLElement>(
        '[aria-label="Answer"][data-open="true"]',
      )
      let reserved = panel === null ? 0 : panel.offsetWidth + 16
      let width = host.offsetWidth
      let roomAbove = anchor.y - CARD_GAP - NAVBAR_FLOOR
      let roomBelow = bounds.height - anchor.y - CARD_GAP - CARD_PAD
      // Sit above the dot like a tooltip; only drop below when the dot is so
      // close to the top that there is no usable card height.
      let above = roomAbove >= 240
      let room = above ? roomAbove : roomBelow

      host.style.maxHeight = `${Math.max(220, room)}px`
      host.style.left = `${Math.min(
        Math.max(CARD_PAD, anchor.x - CARD_GAP - width),
        bounds.width - reserved - width - CARD_PAD,
      )}px`

      if (above) {
        host.style.top = 'auto'
        host.style.bottom = `${bounds.height - anchor.y + CARD_GAP}px`
      } else {
        host.style.bottom = 'auto'
        host.style.top = `${anchor.y + CARD_GAP}px`
      }
      host.dataset.side = above ? 'above' : 'below'
    }

    let unsubscribe = session.onAnchor(place)
    handle.signal.addEventListener('abort', unsubscribe, { once: true })

    session.addEventListener(
      'change',
      async () => {
        let next = session.selected

        if (next === null) {
          if (last === null || closing) return

          // Keep the last station on screen while the exit animation runs.
          closing = true
          await handle.update()
          closingTimer = setTimeout(() => {
            closing = false
            last = null
            handle.update()
          }, CARD_EXIT_MS)
          return
        }

        clearTimeout(closingTimer)
        closing = false
        last = next
        await handle.update()
        place(session.anchor)
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      last = session.selected
      place(session.anchor)
    })

    return () => {
      let station = session.selected ?? (closing ? last : null)
      let facts = station?.facts ?? null
      let humidity = facts === null ? null : humidityPercent(facts.temperature)
      let echo =
        weatherLayers.rain && session.echoShare !== null
          ? Math.round(session.echoShare * 100)
          : null

      return (
        <div
          mix={[hostStyle, ref((node) => (host = node))]}
          style={{
            display: station === null ? 'none' : 'flex',
            animation: closing
              ? 'rmx-card-out 160ms ease-in forwards'
              : 'rmx-card-in 180ms ease-out',
            pointerEvents: closing ? 'none' : undefined,
          }}
        >
          {station === null ? null : (
            <>
              <header mix={headerStyle}>
                <div mix={identityStyle}>
                  <span mix={icaoStyle}>{station.icao}</span>
                  <span mix={nameStyle}>{station.name}</span>
                </div>
              </header>

              {/* The conditions live in the panel, which is open whenever a
                  station is selected. The card says which dot this is, the two
                  numbers that belong to the area rather than the report,
                  somewhere better when the report is old, and asks. */}
              {facts === null ? null : (
                <dl mix={factsStyle}>
                  <Fact
                    label="Humidity"
                    value={humidity === null ? 'not reported' : `${humidity}%`}
                  />
                  <Fact
                    label="Echo"
                    value={echo === null ? 'no radar' : `${echo}%`}
                  />
                </dl>
              )}

              {session.suggested.length === 0 ? null : (
                <div mix={[bodyStyle, suggestedStyle]}>
                  <p mix={suggestedLeadStyle}>This report is old. Nearby:</p>
                  {session.suggested.map((item) => (
                    <button
                      key={item.icao}
                      mix={[
                        suggestedButtonStyle,
                        on('click', () => void session.select(item.icao)),
                      ]}
                      type="button"
                    >
                      <span mix={suggestedCodeStyle}>{item.icao}</span>
                      <span mix={suggestedNameStyle}>{item.name}</span>
                      <span mix={suggestedMetaStyle}>
                        {item.distance_nm} nm · {ageLabel(item.age_seconds)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )
    }
  },
)

function Fact(handle: Handle<{ label: string; value: string }>) {
  return () => (
    <div mix={factStyle}>
      <dt>{handle.props.label}</dt>
      <dd>{handle.props.value}</dd>
    </div>
  )
}

const hostStyle = css({
  position: 'absolute',
  top: '84px',
  left: '16px',
  zIndex: 3,
  width: 'min(320px, calc(100vw - 32px))',
  flexDirection: 'column',
  borderRadius: '16px',
  background: 'var(--glass-strong)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(26px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(26px) saturate(1.25)',
  overflow: 'hidden',
  animation: 'rmx-card-in 180ms ease-out',
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '10px 12px 8px',
  borderBlockEnd: '1px solid var(--glass-border)',
})

const identityStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  minWidth: 0,
})

const icaoStyle = css({ fontWeight: 700 })

const nameStyle = css({
  fontSize: '11px',
  color: 'var(--ink-3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '10px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  '& > p': { margin: 0 },
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '2px 12px',
  margin: 0,
  padding: '2px 12px 10px',
})

const factStyle = css({
  margin: 0,
  fontSize: '12px',
  '& dt': { fontSize: '10px', color: 'var(--ink-3)' },
  '& dd': { margin: 0 },
})

const suggestedStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  paddingBlockStart: '8px',
  borderBlockStart: '1px solid var(--glass-border)',
})

const suggestedLeadStyle = css({
  margin: 0,
  fontSize: '10px',
  color: 'var(--ink-3)',
})

const suggestedButtonStyle = css({
  display: 'grid',
  gridTemplateColumns: '3.6rem 1fr',
  gap: '2px 8px',
  padding: '6px 8px',
  border: '1px solid var(--glass-border)',
  borderRadius: '10px',
  background: 'transparent',
  color: 'var(--ink-0)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  '&:hover': { background: 'rgba(255, 255, 255, 0.05)' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '-2px',
  },
})

const suggestedCodeStyle = css({ fontSize: '12px', fontWeight: 700 })

const suggestedNameStyle = css({
  fontSize: '11px',
  color: 'var(--ink-2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const suggestedMetaStyle = css({
  gridColumn: '2',
  fontSize: '10px',
  color: 'var(--ink-3)',
})
