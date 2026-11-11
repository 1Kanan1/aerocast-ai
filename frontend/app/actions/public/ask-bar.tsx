import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { SendIcon, StopIcon } from '#app/ui/public/icons.tsx'
import { session } from '#app/ui/public/session.ts'

/** The ask-first composer: it floats over the map and needs no station. */
export const AskBar = clientEntry(
  import.meta.url,
  function AskBar(handle: Handle) {
    let draft = ''

    session.addEventListener('change', () => handle.update(), {
      signal: handle.signal,
    })

    return () => {
      let station = session.selected
      let inArea = session.area !== null
      let pending =
        (station !== null && station.thread.some((entry) => entry.pending)) ||
        session.areaThread.some((entry) => entry.pending)
      let open = station !== null || session.clarification !== null || inArea

      return (
        <div data-panel={open ? 'true' : 'false'} mix={dockStyle}>
          <p mix={noteStyle}>
            Educational tool. Not for flight planning or navigation. Get an
            official briefing from Flight Service (1-800-WX-BRIEF) before you
            fly.
          </p>
          <form
            mix={[
              barStyle,
              on('submit', (event) => {
                event.preventDefault()
                let question = draft.trim()
                if (question === '') return

                let field = event.currentTarget.elements.namedItem('question')
                draft = ''
                event.currentTarget.reset()
                if (field instanceof HTMLTextAreaElement) {
                  field.style.height = 'auto'
                }
                handle.update()
                void session.askQuestion(question)
              }),
            ]}
          >
            <textarea
              aria-label="Ask about the weather"
              data-ask-field="true"
              maxLength={400}
              mix={[
                on('input', (event) => {
                  draft = event.currentTarget.value
                  let field = event.currentTarget
                  field.style.height = 'auto'
                  field.style.height = `${Math.min(field.scrollHeight, 108)}px`
                  handle.update()
                }),
                on('keydown', (event) => {
                  if (event.key !== 'Enter' || event.shiftKey) return
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }),
              ]}
              name="question"
              placeholder={
                station !== null
                  ? `Ask about ${station.icao}'s weather…`
                  : inArea
                    ? 'Ask about the weather here…'
                    : 'Ask about the weather anywhere…'
              }
              rows={1}
            />
            {pending ? (
              <button
                aria-label="Stop answer"
                mix={[sendStyle, on('click', () => session.cancelAsk())]}
                type="button"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                aria-label="Send question"
                disabled={draft.trim() === ''}
                mix={sendStyle}
                type="submit"
              >
                <SendIcon />
              </button>
            )}
          </form>
        </div>
      )
    }
  },
)

const dockStyle = css({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '20px',
  zIndex: 5,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '8px',
  paddingInline: '16px',
  pointerEvents: 'none',
  transition: 'right 240ms cubic-bezier(0.22, 1, 0.36, 1)',
  // The map's zoom control owns the bottom-left corner.
  '@media (max-width: 1240px)': { left: '64px' },
  '&[data-panel="true"]': { right: '552px', left: '64px' },
  '@media (max-width: 900px)': {
    '&[data-panel="true"]': { right: 0 },
  },
})

const barStyle = css({
  pointerEvents: 'auto',
  display: 'flex',
  alignItems: 'flex-end',
  gap: '8px',
  width: 'min(640px, 100%)',
  padding: '6px 8px 6px 16px',
  border: '1px solid var(--glass-border)',
  borderRadius: '20px',
  background: 'var(--glass-strong)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(24px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.2)',
  transition: 'border-color 140ms ease',
  '&:focus-within': { borderColor: 'rgba(255, 255, 255, 0.24)' },
  '& textarea': {
    flex: '1 1 auto',
    minWidth: 0,
    minHeight: '38px',
    maxHeight: '108px',
    padding: '9px 0',
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '14px',
    lineHeight: 1.5,
    resize: 'none',
    overflowY: 'auto',
  },
  '& textarea::placeholder': { color: 'var(--ink-3)' },
})

const sendStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '34px',
  height: '34px',
  flexShrink: 0,
  border: 0,
  borderRadius: '999px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  cursor: 'pointer',
  transition: 'opacity 120ms ease, transform 120ms ease',
  '&:hover': { transform: 'translateY(-1px)' },
  '&:disabled': { opacity: 0.3, cursor: 'not-allowed', transform: 'none' },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

const noteStyle = css({
  margin: 0,
  maxWidth: 'min(560px, 100%)',
  fontSize: '10px',
  lineHeight: 1.4,
  color: 'var(--ink-3)',
  textAlign: 'center',
  textWrap: 'balance',
})
