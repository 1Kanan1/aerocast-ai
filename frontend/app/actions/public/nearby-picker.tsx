import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import type { NearbyChoice } from '#app/ui/public/session.ts'
import { session } from '#app/ui/public/session.ts'

/** How long the list takes to leave, matching rmx-card-out. */
const PICKER_EXIT_MS = 140

/**
 * A click on empty map asks the server which stations sit around it. This is
 * the list it gets back: choosing one selects it, exactly as a search hit or
 * a marker would.
 */
export const NearbyPicker = clientEntry(
  import.meta.url,
  function NearbyPicker(handle: Handle) {
    // Keep the list on screen for one beat while it fades out.
    let closing = false
    let closingTimer: ReturnType<typeof setTimeout> | undefined
    let last: NearbyChoice | null = session.nearby

    session.addEventListener(
      'change',
      async () => {
        let next = session.nearby

        if (next === null) {
          if (last === null || closing) return

          closing = true
          await handle.update()
          closingTimer = setTimeout(() => {
            closing = false
            last = null
            handle.update()
          }, PICKER_EXIT_MS)
          return
        }

        clearTimeout(closingTimer)
        closing = false
        last = next
        await handle.update()
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.key !== 'Escape' || session.nearby === null) return
          session.setNearby(null)
          handle.update()
        },
        { signal: handle.signal },
      )
    })

    return () => {
      let choice = session.nearby ?? (closing ? last : null)
      if (choice === null) return null

      return (
        <div
          aria-label="Stations here"
          mix={panelStyle}
          style={{
            left: `${Math.min(choice.x, Math.max(12, window.innerWidth - 320))}px`,
            top: `${Math.min(choice.y, Math.max(12, window.innerHeight - 260))}px`,
            animation: closing
              ? 'rmx-card-out 140ms ease-in forwards'
              : undefined,
            pointerEvents: closing ? 'none' : undefined,
          }}
        >
          <header mix={headerStyle}>
            <span mix={titleStyle}>Stations here</span>
            <button
              aria-label="Close station list"
              mix={[closeStyle, on('click', () => session.setNearby(null))]}
              type="button"
            >
              ×
            </button>
          </header>

          {choice.stations.length === 0 ? (
            <p mix={emptyStyle}>No station within 80 nm of that point.</p>
          ) : (
            <ul mix={listStyle}>
              {choice.stations.map((station) => (
                <li key={station.icao}>
                  <button
                    aria-label={`Select ${station.icao}`}
                    mix={[
                      rowStyle,
                      on('click', () => {
                        session.setNearby(null)
                        void session.select(station.icao)
                      }),
                    ]}
                    type="button"
                  >
                    <span mix={codeStyle}>{station.icao}</span>
                    <span mix={nameStyle}>{station.name}</span>
                    <span mix={distanceStyle}>{station.distance_nm} nm</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )
    }
  },
)

const panelStyle = css({
  position: 'absolute',
  zIndex: 4,
  width: '300px',
  padding: '10px',
  border: '1px solid var(--glass-border)',
  borderRadius: '14px',
  background: 'var(--glass-strong)',
  boxShadow: 'var(--shadow)',
  animation: 'rmx-card-in 140ms ease-out',
  '@media (max-width: 900px)': { display: 'none' },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '0 2px 8px',
})

const titleStyle = css({
  fontSize: '10px',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const closeStyle = css({
  width: '22px',
  height: '22px',
  padding: 0,
  border: '1px solid var(--glass-border)',
  borderRadius: '50%',
  background: 'transparent',
  color: 'var(--ink-2)',
  fontSize: '14px',
  lineHeight: 1,
  cursor: 'pointer',
})

const listStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  margin: 0,
  padding: 0,
  listStyle: 'none',
})

const rowStyle = css({
  display: 'grid',
  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
  alignItems: 'baseline',
  gap: '8px',
  width: '100%',
  padding: '6px 8px',
  border: 'none',
  borderRadius: '8px',
  background: 'transparent',
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

const codeStyle = css({ fontSize: '12px', color: 'var(--ink-0)' })
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
const emptyStyle = css({
  margin: 0,
  padding: '2px 4px 4px',
  fontSize: '12px',
  color: 'var(--ink-3)',
})
