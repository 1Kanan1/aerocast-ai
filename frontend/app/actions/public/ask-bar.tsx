import type { Handle } from 'remix/component'
import { clientEntry, css, on } from 'remix/component'

import { SendIcon, StopIcon } from '#app/ui/public/icons.tsx'
import { askHistory } from '#app/ui/public/ask-history.ts'
import { session } from '#app/ui/public/session.ts'

/** The ask-first composer: it floats over the map and needs no station. */
export const AskBar = clientEntry(
  import.meta.url,
  function AskBar(handle: Handle) {
    let draft = ''
    /** Where in the history the field is, or null while it holds a draft. */
    let recalled: number | null = null
    /** The draft the reader had before walking into the history. */
    let draftBefore = ''

    function fill(field: HTMLTextAreaElement, value: string): void {
      field.value = value
      draft = value
      field.style.height = 'auto'
      field.style.height = `${Math.min(field.scrollHeight, 108)}px`
      field.setSelectionRange(value.length, value.length)
      handle.update()
    }

    function recallOlder(field: HTMLTextAreaElement): void {
      let items = askHistory.items
      if (items.length === 0) return

      if (recalled === null) {
        draftBefore = field.value
        recalled = items.length - 1
      } else if (recalled > 0) {
        recalled -= 1
      } else {
        return
      }

      fill(field, items[recalled])
    }

    function recallNewer(field: HTMLTextAreaElement): void {
      if (recalled === null) return
      let items = askHistory.items

      if (recalled < items.length - 1) {
        recalled += 1
        fill(field, items[recalled])
        return
      }

      recalled = null
      fill(field, draftBefore)
    }

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

                // The composer remembers only what was typed into it, and
                // remembers it before the question goes anywhere: the answer
                // may fail, but the words were still asked.
                askHistory.record(question)

                let field = event.currentTarget.elements.namedItem('question')
                draft = ''
                recalled = null
                draftBefore = ''
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
              data-focus-ring="parent"
              maxLength={400}
              mix={[
                on('input', (event) => {
                  recalled = null
                  draft = event.currentTarget.value
                  let field = event.currentTarget
                  field.style.height = 'auto'
                  field.style.height = `${Math.min(field.scrollHeight, 108)}px`
                  handle.update()
                }),
                on('keydown', (event) => {
                  let field = event.currentTarget
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    field.form?.requestSubmit()
                    return
                  }

                  // A one-line value has nowhere for the caret to go, so the
                  // arrows recall from anywhere; a multi-line draft keeps
                  // them for the caret on its first and last line.
                  let multiline = field.value.includes('\n')
                  let atStart = field.selectionStart === 0
                  let atEnd = field.selectionStart === field.value.length

                  if (
                    event.key === 'ArrowUp' &&
                    (recalled !== null || !multiline || atStart)
                  ) {
                    if (askHistory.items.length === 0) return
                    event.preventDefault()
                    recallOlder(field)
                    return
                  }

                  if (
                    event.key === 'ArrowDown' &&
                    recalled !== null &&
                    (!multiline || atEnd)
                  ) {
                    event.preventDefault()
                    recallNewer(field)
                  }
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
              title="Press the up arrow to reuse an earlier question"
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
  bottom: '44px',
  zIndex: 6,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: '8px',
  paddingInline: '16px',
  pointerEvents: 'none',
  transition:
    'right 280ms var(--ease-out), left 280ms var(--ease-out), bottom 240ms var(--ease-out)',
  // The map's zoom control owns the bottom-left corner.
  '@media (max-width: 1240px)': { left: '64px' },
  '&[data-panel="true"]': { right: '532px', left: '64px' },
  '@media (max-width: 900px)': {
    left: 0,
    right: 0,
    bottom: '12px',
    zIndex: 8,
    paddingInline: '12px',
    '&[data-panel="true"]': { right: 0, left: 0 },
    '&[data-panel="true"] p': { display: 'none' },
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
  transition:
    'border-color 160ms var(--ease-out), background-color 220ms var(--ease-out), box-shadow 220ms var(--ease-out)',
  '&:focus-within': { borderColor: 'var(--line-strong)' },
  // The textarea draws no outline of its own, so one calm ring goes on the pill.
  '&:has(textarea:focus-visible)': {
    outline: '2px solid var(--focus-ring)',
    outlineOffset: '2px',
  },
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
  background: 'var(--accent)',
  color: 'var(--accent-ink)',
  cursor: 'pointer',
  transition:
    'opacity 140ms var(--ease-out), transform 160ms var(--ease-spring)',
  '&:hover': { transform: 'translateY(-1px) scale(1.03)' },
  '&:active': { transform: 'scale(0.94)' },
  '&:disabled': { opacity: 0.32, cursor: 'not-allowed', transform: 'none' },
  '&:focus-visible': {
    outline: '2px solid var(--accent)',
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
