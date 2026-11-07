import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import { ageLabel } from '../../lib/format.ts'
import {
  ceilingLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from '../../lib/public/labels.ts'
import { routes } from '../../routes.ts'
import { type Anchor, session } from '../../ui/public/session.ts'

/** The station card, anchored over its dot and clamped to the map area. */
export const StationPopup = clientEntry(
  import.meta.url,
  function StationPopup(handle: Handle) {
    let host: HTMLElement | undefined
    let lastAnchor: Anchor | null = null

    function place(anchor: Anchor | null): void {
      lastAnchor = anchor
      if (!host || anchor === null || !host.parentElement) return

      let bounds = host.parentElement.getBoundingClientRect()
      let width = host.offsetWidth
      let gap = 16
      let pad = 10
      let topLimit = 84
      let spaceAbove = anchor.y - gap - topLimit
      let spaceBelow = bounds.height - anchor.y - gap - pad
      let above = spaceAbove >= Math.max(180, spaceBelow)
      let space = Math.max(160, above ? spaceAbove : spaceBelow)

      host.style.maxHeight = `${space}px`

      let left = Math.min(
        Math.max(anchor.x, pad + width / 2),
        bounds.width - pad - width / 2,
      )

      host.style.left = `${left}px`
      host.style.top = above ? `${anchor.y - gap}px` : `${anchor.y + gap}px`
      host.style.transform = above
        ? 'translate(-50%, -100%)'
        : 'translate(-50%, 0)'
      host.dataset.side = above ? 'above' : 'below'
    }

    let unsubscribe = session.onAnchor(place)
    handle.signal.addEventListener('abort', unsubscribe, { once: true })

    session.addEventListener(
      'change',
      async () => {
        await handle.update()
        place(lastAnchor)
      },
      { signal: handle.signal },
    )

    handle.queueTask(() => {
      place(session.anchor)
    })

    return () => {
      let station = session.selected
      let facts = station?.facts ?? null

      return (
        <div
          mix={[hostStyle, ref((node) => (host = node))]}
          style={{ display: station === null ? 'none' : 'flex' }}
        >
          {station === null ? null : (
            <>
              <header mix={headerStyle}>
                <div>
                  <span mix={icaoStyle}>{station.icao}</span>
                  <span mix={nameStyle}>{station.name}</span>
                </div>
                <button
                  aria-label="Close station panel"
                  mix={[closeStyle, on('click', () => session.clear())]}
                  type="button"
                >
                  ×
                </button>
              </header>

              <div mix={bodyStyle}>
                {station.loading ? (
                  <p mix={mutedStyle}>Loading station facts…</p>
                ) : station.error !== null ? (
                  <p mix={mutedStyle}>{station.error}</p>
                ) : (
                  <>
                    <p mix={categoryStyle}>
                      {station.category ?? 'no category'}
                      {station.basis === null ? '' : ` · ${station.basis}`}
                    </p>

                    <p mix={ageStyle}>
                      Observed {ageLabel(station.ageSeconds)}
                      {station.stale ? (
                        <span mix={staleStyle}>stale</span>
                      ) : null}
                    </p>

                    {facts === null ? (
                      <p mix={mutedStyle}>No observation on file.</p>
                    ) : (
                      <>
                        <dl mix={factsStyle}>
                          <Fact label="Wind" value={windLabel(facts)} />
                          <Fact
                            label="Visibility"
                            value={visibilityLabel(facts)}
                          />
                          <Fact label="Ceiling" value={ceilingLabel(facts)} />
                          <Fact
                            label="Temperature"
                            value={temperatureLabel(facts)}
                          />
                        </dl>
                        <code mix={rawStyle}>{facts.raw}</code>
                      </>
                    )}

                    <p mix={mutedStyle}>
                      {station.advisories === 0
                        ? 'No active advisories within 50 nm.'
                        : `${station.advisories} active ${
                            station.advisories === 1 ? 'advisory' : 'advisories'
                          } within 50 nm.`}
                    </p>
                  </>
                )}
              </div>

              <footer mix={footerStyle}>
                <a
                  mix={pageLinkStyle}
                  href={routes.station.href({ icao: station.icao })}
                >
                  Open full page →
                </a>
                <form
                  mix={[
                    composerStyle,
                    on('submit', (event) => {
                      event.preventDefault()
                      let form = event.currentTarget
                      let question = String(
                        new FormData(form).get('question') ?? '',
                      )
                      form.reset()

                      let drawer = document.getElementById('ai-drawer')
                      drawer?.showPopover()
                      void session.ask(question)
                    }),
                  ]}
                >
                  <input
                    aria-label="Ask about this station"
                    maxLength={400}
                    name="question"
                    placeholder="Ask about this station"
                    type="text"
                  />
                  <button mix={askStyle} type="submit">
                    Ask
                  </button>
                </form>
              </footer>
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
  zIndex: 3,
  width: 'min(340px, calc(100% - 24px))',
  maxHeight: 'calc(100% - 24px)',
  flexDirection: 'column',
  borderRadius: '20px',
  background: 'var(--glass-strong)',
  border: '1px solid var(--glass-border)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(26px) saturate(1.25)',
  WebkitBackdropFilter: 'blur(26px) saturate(1.25)',
  overflow: 'visible',
  '&::after': {
    content: '""',
    position: 'absolute',
    left: '50%',
    bottom: '-5px',
    width: '10px',
    height: '10px',
    marginInlineStart: '-5px',
    borderRadius: '2px',
    background: 'var(--glass-strong)',
    borderInlineEnd: '1px solid var(--glass-border)',
    borderBlockEnd: '1px solid var(--glass-border)',
    transform: 'rotate(45deg)',
  },
  '&[data-side="below"]::after': {
    bottom: 'auto',
    top: '-5px',
    borderInlineEnd: 0,
    borderBlockEnd: 0,
    borderInlineStart: '1px solid var(--glass-border)',
    borderBlockStart: '1px solid var(--glass-border)',
  },
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '8px',
  padding: '12px 14px 10px',
  borderBlockEnd: '1px solid var(--glass-border)',
})

const icaoStyle = css({ fontWeight: 700, letterSpacing: '0.06em' })

const nameStyle = css({
  display: 'block',
  fontSize: '11px',
  color: 'var(--ink-3)',
})

const closeStyle = css({
  width: '26px',
  height: '26px',
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'rgba(255, 255, 255, 0.04)',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '15px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-0)', background: 'rgba(255, 255, 255, 0.08)' },
})

const bodyStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  padding: '12px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
  '& > p': { margin: 0 },
})

const categoryStyle = css({ fontSize: '12px', fontWeight: 700 })

const ageStyle = css({ fontSize: '11px', color: 'var(--ink-3)' })

const staleStyle = css({
  marginInlineStart: '6px',
  padding: '0 6px',
  border: '1px solid var(--accent)',
  borderRadius: '999px',
  color: 'var(--accent)',
})

const factsStyle = css({
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: '8px 12px',
  margin: 0,
})

const factStyle = css({
  margin: 0,
  '& dt': {
    fontSize: '10px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--ink-3)',
  },
  '& dd': { margin: 0, fontSize: '12px' },
})

const rawStyle = css({
  display: 'block',
  padding: '7px 9px',
  border: '1px solid var(--glass-border)',
  borderRadius: '12px',
  background: 'rgba(0, 0, 0, 0.25)',
  fontSize: '11px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
})

const mutedStyle = css({ fontSize: '12px', color: 'var(--ink-3)' })

const footerStyle = css({
  borderBlockStart: '1px solid var(--glass-border)',
  padding: '10px 14px 12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '8px',
})

const pageLinkStyle = css({
  fontSize: '11px',
  color: 'var(--ink-2)',
  textDecoration: 'none',
  '&:hover': { color: 'var(--ink-0)' },
})

const composerStyle = css({
  display: 'flex',
  gap: '6px',
  '& input': {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '7px 10px',
    border: '1px solid var(--glass-border)',
    borderRadius: '999px',
    background: 'rgba(0, 0, 0, 0.28)',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '12px',
  },
})

const askStyle = css({
  padding: '7px 14px',
  border: '1px solid rgba(255, 255, 255, 0.16)',
  borderRadius: '999px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  font: 'inherit',
  fontSize: '12px',
  cursor: 'pointer',
})
