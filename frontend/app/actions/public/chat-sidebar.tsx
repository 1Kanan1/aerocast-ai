import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import { session } from '#app/ui/public/session.ts'
import { closePopover, onPopoverDismiss } from '#app/ui/public/popover.ts'
import { SendIcon, StopIcon } from '#app/ui/public/icons.tsx'
import {
  type Suggestion,
  AssistantTurn,
  ThreadWelcome,
  UserTurn,
} from '#app/ui/public/thread-parts.tsx'

const DRAWER_EXIT_MS = 200

const SUGGESTIONS: readonly Suggestion[] = [
  { prompt: 'What is the ceiling?' },
  { prompt: 'What is the visibility?' },
  { prompt: 'What is the wind doing?' },
  { prompt: 'What does the forecast say?' },
  { prompt: 'What does MVFR mean?' },
]

/** The persistent right column: one thread, shared with the station popup. */
export const ChatSidebar = clientEntry(
  import.meta.url,
  function ChatSidebar(handle: Handle) {
    let root: HTMLElement | undefined
    let scroller: HTMLElement | undefined
    let composer: HTMLTextAreaElement | undefined
    let draft = ''

    function drawer(): HTMLElement | null {
      let popover = root?.closest('[popover]')
      return popover instanceof HTMLElement ? popover : null
    }

    function scrollToEnd(): void {
      if (scroller) scroller.scrollTop = scroller.scrollHeight
    }

    function editLast(): void {
      let question = session.rewindLast()
      if (question === null) return

      draft = question
      handle.update()
      if (composer) {
        composer.value = question
        composer.style.height = 'auto'
        composer.style.height = `${Math.min(composer.scrollHeight, 132)}px`
        composer.focus()
      }
    }

    handle.queueTask(() => {
      let panel = drawer()
      if (panel === null) return
      onPopoverDismiss(
        panel,
        () => closePopover(panel, DRAWER_EXIT_MS),
        handle.signal,
      )
      scrollToEnd()
    })

    session.addEventListener(
      'change',
      async () => {
        await handle.update()
        scrollToEnd()
      },
      { signal: handle.signal },
    )

    return () => {
      let station = session.selected
      let pending =
        station !== null && station.thread.some((entry) => entry.pending)
      let canAsk = station !== null && !pending

      return (
        <div mix={[sidebarStyle, ref((node) => (root = node))]}>
          <header mix={headerStyle}>
            <div mix={headingStyle}>
              <span mix={titleStyle}>Explanation</span>
              {station === null ? null : (
                <span mix={stationLineStyle}>
                  {station.icao} · {station.name}
                  {station.category === null ? '' : ` · ${station.category}`}
                </span>
              )}
            </div>
            <span mix={actionsStyle}>
              {station === null ? null : (
                <button
                  mix={[clearStyle, on('click', () => session.clear())]}
                  type="button"
                >
                  Clear
                </button>
              )}
              <button
                aria-label="Close explanation"
                mix={[
                  closeStyle,
                  on('click', () => {
                    let panel = drawer()
                    if (panel !== null) closePopover(panel, DRAWER_EXIT_MS)
                  }),
                ]}
                type="button"
              >
                ×
              </button>
            </span>
          </header>

          <div mix={[threadStyle, ref((node) => (scroller = node))]}>
            {station === null ? (
              <div mix={emptyStyle}>
                <p mix={kickerStyle}>Explanation layer</p>
                <h2 mix={emptyTitleStyle}>Select a station</h2>
                <p mix={emptyTextStyle}>
                  Pick a dot on the map, then ask about its weather. Answers
                  restate the facts shown there and cite them.
                </p>
              </div>
            ) : station.thread.length === 0 ? (
              <ThreadWelcome
                category={station.category}
                disabled={!canAsk}
                icao={station.icao}
                name={station.name}
                onAsk={(prompt) => void session.ask(prompt)}
                suggestions={SUGGESTIONS}
              />
            ) : (
              station.thread.map((entry, index) => (
                <div key={`${entry.question}-${index}`} mix={exchangeStyle}>
                  <UserTurn
                    onEdit={
                      index === station.thread.length - 1 && !entry.pending
                        ? editLast
                        : undefined
                    }
                    question={entry.question}
                  />
                  <AssistantTurn entry={entry} />
                </div>
              ))
            )}
          </div>

          <form
            mix={[
              composerStyle,
              on('submit', (event) => {
                event.preventDefault()
                let form = event.currentTarget
                let question = draft.trim()
                let field = form.elements.namedItem('question')
                form.reset()
                if (field instanceof HTMLTextAreaElement) {
                  field.style.height = 'auto'
                }
                draft = ''
                handle.update()
                if (question !== '') void session.ask(question)
              }),
            ]}
          >
            <div mix={composerShellStyle}>
              <textarea
                aria-label="Ask about the selected station"
                disabled={!canAsk}
                maxLength={400}
                mix={[
                  ref((node) => (composer = node)),
                  on('input', (event) => {
                    draft = event.currentTarget.value
                    let field = event.currentTarget
                    field.style.height = 'auto'
                    field.style.height = `${Math.min(field.scrollHeight, 132)}px`
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
                  station === null
                    ? 'Select a station first'
                    : `Ask about ${station.icao}'s weather…`
                }
                rows={1}
              />
              <div mix={composerRowStyle}>
                <span mix={hintStyle}>
                  {station === null
                    ? 'Select a station to ask'
                    : pending
                      ? 'Working…'
                      : 'Enter to send · Shift+Enter for a new line'}
                </span>
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
                    disabled={!canAsk || draft.trim() === ''}
                    mix={sendStyle}
                    type="submit"
                  >
                    <SendIcon />
                  </button>
                )}
              </div>
            </div>
          </form>

          <p mix={disclaimerStyle}>
            Generated explanation. It restates only the data shown on this page,
            cannot assess your aircraft or your ratings, and never makes a
            go/no-go call.
          </p>
        </div>
      )
    }
  },
)

const sidebarStyle = css({
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  minHeight: 0,
})

const headerStyle = css({
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '12px',
  padding: '16px 20px 12px',
  borderBlockEnd: '1px solid var(--glass-border)',
})

const headingStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '3px',
  minWidth: 0,
})

const titleStyle = css({
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
})

const stationLineStyle = css({
  fontSize: '11px',
  color: 'var(--ink-2)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const actionsStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  flexShrink: 0,
})

const clearStyle = css({
  border: 0,
  background: 'none',
  padding: 0,
  color: 'var(--ink-3)',
  font: 'inherit',
  fontSize: '11px',
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-1)' },
})

const closeStyle = css({
  width: '28px',
  height: '28px',
  borderRadius: '999px',
  border: '1px solid var(--glass-border)',
  background: 'rgba(255, 255, 255, 0.04)',
  color: 'var(--ink-2)',
  font: 'inherit',
  fontSize: '16px',
  lineHeight: 1,
  cursor: 'pointer',
  '&:hover': { color: 'var(--ink-0)', background: 'rgba(255, 255, 255, 0.08)' },
})

const threadStyle = css({
  flex: '1 1 auto',
  minHeight: 0,
  overflowY: 'auto',
  overflowX: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  gap: '22px',
  padding: '16px 20px 8px',
  scrollBehavior: 'smooth',
})

const exchangeStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
})

const emptyStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '7px',
  marginBlock: 'auto',
  paddingBlock: '12px',
})

const kickerStyle = css({
  margin: 0,
  fontSize: '10px',
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--accent)',
})

const emptyTitleStyle = css({
  margin: 0,
  fontSize: '20px',
  fontWeight: 600,
  color: 'var(--ink-0)',
})

const emptyTextStyle = css({
  margin: 0,
  fontSize: '12px',
  lineHeight: 1.55,
  color: 'var(--ink-3)',
})

const composerStyle = css({
  padding: '12px 20px 8px',
  borderBlockStart: '1px solid var(--glass-border)',
})

const composerShellStyle = css({
  display: 'flex',
  flexDirection: 'column',
  gap: '2px',
  padding: '8px',
  border: '1px solid var(--glass-border)',
  borderRadius: '16px',
  background: 'rgba(0, 0, 0, 0.26)',
  transition: 'border-color 140ms ease',
  '&:focus-within': { borderColor: 'rgba(255, 255, 255, 0.22)' },
  '& textarea': {
    width: '100%',
    minHeight: '40px',
    maxHeight: '132px',
    padding: '5px 6px 3px',
    border: 0,
    outline: 'none',
    background: 'transparent',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '13px',
    lineHeight: 1.55,
    resize: 'none',
    overflowY: 'auto',
  },
  '& textarea::placeholder': { color: 'var(--ink-3)' },
  '& textarea:disabled': { cursor: 'not-allowed' },
})

const composerRowStyle = css({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '8px',
  paddingInlineStart: '6px',
})

const hintStyle = css({
  fontSize: '10px',
  color: 'var(--ink-3)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
})

const sendStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '30px',
  height: '30px',
  flexShrink: 0,
  border: 0,
  borderRadius: '999px',
  background: 'var(--ink-0)',
  color: 'var(--paper)',
  cursor: 'pointer',
  transition: 'opacity 120ms ease, transform 120ms ease',
  '&:hover': { transform: 'translateY(-1px)' },
  '&:disabled': { opacity: 0.3, cursor: 'not-allowed', transform: 'none' },
})

const disclaimerStyle = css({
  margin: 0,
  padding: '0 20px 16px',
  fontSize: '10px',
  lineHeight: 1.5,
  color: 'var(--ink-3)',
})
