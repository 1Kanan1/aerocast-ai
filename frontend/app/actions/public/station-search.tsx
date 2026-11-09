import type { Handle } from 'remix/component'
import { clientEntry, css, on, ref } from 'remix/component'

import type { Station } from '#app/lib/api-types.ts'
import { routes } from '#app/routes.ts'
import { session } from '#app/ui/public/session.ts'
import { closePopover, onPopoverDismiss } from '#app/ui/public/popover.ts'
import { ArrowIcon, CloseIcon, SearchIcon } from '#app/ui/public/icons.tsx'

interface StationSearchProps {
  initial: Station[]
  query: string
}

const DEBOUNCE_MS = 250
const POP_EXIT_MS = 140

/** The search popover: opened by the navbar icon, searched in place. */
export const StationSearch = clientEntry(
  import.meta.url,
  function StationSearch(handle: Handle<StationSearchProps>) {
    let results = handle.props.initial
    let query = handle.props.query
    let problem: string | null = null
    let pending = false
    let debounce: ReturnType<typeof setTimeout> | undefined
    let controller: AbortController | null = null
    let panel: HTMLElement | undefined

    handle.queueTask(() => {
      if (panel === undefined) return
      let search = panel
      onPopoverDismiss(
        search,
        () => closePopover(search, POP_EXIT_MS),
        handle.signal,
      )
    })

    async function run(value: string): Promise<void> {
      query = value
      problem = null
      pending = true
      handle.update()

      controller?.abort()
      controller = new AbortController()
      let signal = controller.signal

      try {
        let response = await fetch(
          `${routes.search.href()}?q=${encodeURIComponent(value)}`,
          { headers: { accept: 'application/json' }, signal },
        )
        if (!response.ok) throw new Error(`search ${response.status}`)
        if (signal.aborted) return

        let payload = (await response.json()) as { data?: Station[] }
        results = payload.data ?? []
      } catch {
        if (signal.aborted) return
        results = []
        problem = 'Search is unavailable right now.'
      }

      pending = false
      handle.update()
    }

    handle.signal.addEventListener(
      'abort',
      () => {
        clearTimeout(debounce)
        controller?.abort()
      },
      { once: true },
    )

    return () => (
      <div
        id="station-search"
        mix={[panelStyle, ref((node) => (panel = node))]}
        popover="manual"
      >
        <form
          action={routes.home.href()}
          method="get"
          mix={[
            rowStyle,
            on('submit', (event) => {
              event.preventDefault()
              clearTimeout(debounce)
              void run(
                String(new FormData(event.currentTarget).get('q') ?? '').trim(),
              )
            }),
          ]}
        >
          <span mix={leadingIconStyle}>
            <SearchIcon />
          </span>
          <input
            aria-label="Search stations"
            autofocus
            defaultValue={query}
            name="q"
            mix={on('input', (event) => {
              let value = event.currentTarget.value
              clearTimeout(debounce)
              debounce = setTimeout(() => {
                void run(value.trim())
              }, DEBOUNCE_MS)
            })}
            placeholder="ICAO, name or state"
            type="text"
          />
          <button aria-label="Run search" mix={iconStyle} type="submit">
            <ArrowIcon />
          </button>
          <button
            aria-label="Close search"
            mix={[
              iconStyle,
              on('click', () => {
                if (panel !== undefined) closePopover(panel, POP_EXIT_MS)
              }),
            ]}
            type="button"
          >
            <CloseIcon />
          </button>
        </form>

        <div mix={resultsStyle}>
          {query === '' ? null : problem !== null ? (
            <p mix={emptyStyle}>{problem}</p>
          ) : results.length === 0 ? (
            pending ? (
              <p mix={emptyStyle}>Searching…</p>
            ) : (
              <p mix={emptyStyle}>No stations match “{query}”.</p>
            )
          ) : (
            <ul
              mix={[
                listStyle,
                on('click', (event) => {
                  let anchor = (event.target as HTMLElement).closest('a')
                  let icao = anchor?.dataset.icao
                  if (!icao) return

                  event.preventDefault()
                  if (panel !== undefined) closePopover(panel, POP_EXIT_MS)
                  void session.select(icao)
                }),
              ]}
            >
              {results.map((station) => (
                <li key={station.icao}>
                  <a
                    data-icao={station.icao}
                    href={routes.station.href({ icao: station.icao })}
                  >
                    <span mix={icaoStyle}>{station.icao}</span>
                    <span>{station.name}</span>
                    <span mix={stateStyle}>{station.state ?? ''}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    )
  },
)

const panelStyle = css({
  position: 'fixed',
  inset: 'auto',
  top: '88px',
  left: '50%',
  width: 'min(560px, calc(100vw - 24px))',
  margin: 0,
  padding: '8px',
  border: '1px solid var(--glass-border)',
  borderRadius: '16px',
  background: 'var(--glass-strong)',
  color: 'var(--ink-0)',
  boxShadow: 'var(--shadow)',
  backdropFilter: 'blur(26px) saturate(1.2)',
  WebkitBackdropFilter: 'blur(26px) saturate(1.2)',
  opacity: 0,
  transform: 'translateX(-50%)',
  '&:popover-open': {
    opacity: 1,
    animation: 'rmx-pop-in 160ms ease-out',
  },
  '&[data-closing="true"]': {
    animation: 'rmx-pop-out 140ms ease-in forwards',
  },
  '&::backdrop': {
    background: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
  },
  '&:focus-within': { borderColor: 'rgba(255, 255, 255, 0.22)' },
})

const rowStyle = css({
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
  '& input': {
    flex: '1 1 auto',
    minWidth: 0,
    padding: '8px 4px',
    border: 0,
    background: 'transparent',
    color: 'var(--ink-0)',
    font: 'inherit',
    fontSize: '14px',
    outline: 'none',
  },
})

const leadingIconStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  color: 'var(--ink-3)',
})

const iconStyle = css({
  display: 'grid',
  placeItems: 'center',
  width: '32px',
  height: '32px',
  borderRadius: '999px',
  border: '1px solid transparent',
  background: 'transparent',
  color: 'var(--ink-2)',
  cursor: 'pointer',
  '&:hover': {
    background: 'rgba(255, 255, 255, 0.07)',
    color: 'var(--ink-0)',
  },
  '&:focus-visible': {
    outline: '2px solid var(--ink-2)',
    outlineOffset: '2px',
  },
})

const resultsStyle = css({ margin: '2px 4px 4px' })

const listStyle = css({
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: '46vh',
  overflowY: 'auto',
  borderBlockStart: '1px solid var(--glass-border)',
  '& a': {
    display: 'grid',
    gridTemplateColumns: '4.5rem 1fr auto',
    gap: '10px',
    padding: '8px',
    borderRadius: '8px',
    color: 'var(--ink-1)',
    textDecoration: 'none',
    fontSize: '13px',
  },
  '& a:hover': { background: 'rgba(255, 255, 255, 0.06)' },
})

const icaoStyle = css({ fontWeight: 700 })

const stateStyle = css({ color: 'var(--ink-3)' })

const emptyStyle = css({
  margin: '8px',
  fontSize: '12px',
  color: 'var(--ink-3)',
})
