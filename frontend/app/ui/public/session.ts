import { TypedEventTarget } from 'remix/component'

import type { Answer } from '../../lib/answer.ts'
import type { Bundle, BundleMetar } from '../../lib/api-types.ts'
import { routes } from '../../routes.ts'

/** Same threshold the envelope applies, so the popup can flag a stale report. */
const METAR_STALE_SECONDS = 90 * 60

export interface Anchor {
  x: number
  y: number
}

export interface ThreadEntry {
  answer: Answer | null
  pending: boolean
  problem: string | null
  question: string
  refusal: string | null
}

export interface SelectedStation {
  advisories: number
  ageSeconds: number | null
  basis: string | null
  category: string | null
  error: string | null
  facts: BundleMetar | null
  icao: string
  loading: boolean
  name: string
  raw: string | null
  stale: boolean
  thread: ThreadEntry[]
}

/**
 * The map, the popup and the chat sidebar are separate islands, so the
 * selection and the conversation live here rather than in one of them.
 */
export class StationSession extends TypedEventTarget<{ change: Event }> {
  selected: SelectedStation | null = null
  anchor: Anchor | null = null
  #pending: AbortController | null = null
  #anchorListeners = new Set<(anchor: Anchor | null) => void>()

  /** The map owns projection, so it reports the dot's screen point here. */
  onAnchor(listener: (anchor: Anchor | null) => void): () => void {
    this.#anchorListeners.add(listener)
    return () => {
      this.#anchorListeners.delete(listener)
    }
  }

  setAnchor(anchor: Anchor | null): void {
    this.anchor = anchor
    for (let listener of this.#anchorListeners) listener(anchor)
  }

  async select(icao: string): Promise<void> {
    let previous = this.selected
    let thread = previous?.icao === icao ? previous.thread : []

    this.#pending?.abort()
    let controller = new AbortController()
    this.#pending = controller

    this.selected = {
      advisories: 0,
      ageSeconds: null,
      basis: null,
      category: null,
      error: null,
      facts: null,
      icao,
      loading: true,
      name: icao,
      raw: null,
      stale: false,
      thread,
    }
    this.notify()

    try {
      let response = await fetch(routes.brief.href({ icao }), {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`brief ${response.status}`)

      let envelope = (await response.json()) as { data: Bundle }
      if (controller.signal.aborted) return

      let station = envelope.data.stations[0]
      let metar = station?.metar ?? null
      let age = metar?.age_seconds ?? null

      this.selected = {
        ...this.selected,
        name: station?.name ?? icao,
        category: metar?.flight_category.value ?? null,
        basis: metar?.flight_category.basis ?? null,
        facts: metar,
        raw: metar?.raw ?? null,
        ageSeconds: age,
        stale: age !== null && age > METAR_STALE_SECONDS,
        advisories: station?.advisories.length ?? 0,
        loading: false,
      }
    } catch {
      if (controller.signal.aborted) return
      this.selected = {
        ...this.selected,
        loading: false,
        error: 'Station facts are unavailable right now.',
      }
    }

    this.notify()
  }

  async ask(question: string): Promise<void> {
    let selected = this.selected
    let text = question.trim()
    if (selected === null || text === '' || selected.thread.some((entry) => entry.pending)) {
      return
    }

    let entry: ThreadEntry = {
      answer: null,
      pending: true,
      problem: null,
      question: text,
      refusal: null,
    }
    selected.thread.push(entry)
    this.notify()

    let form = new FormData()
    form.set('question', text)

    try {
      let response = await fetch(routes.ask.href({ icao: selected.icao }), {
        method: 'POST',
        body: form,
        headers: { accept: 'application/json' },
      })
      let payload = (await response
        .json()
        .catch(() => null)) as (Partial<Answer> & { error?: string }) | null

      if (!response.ok || payload === null) {
        entry.problem =
          payload?.error ?? 'The explanation layer is not available right now.'
      } else if (payload.refusal) {
        entry.refusal = payload.refusal
      } else if (typeof payload.summary === 'string') {
        entry.answer = {
          summary: payload.summary,
          claims: payload.claims ?? [],
          caveats: payload.caveats ?? [],
          refusal: null,
        }
      } else {
        entry.problem = 'The explanation layer returned an unexpected answer.'
      }
    } catch {
      entry.problem = 'The request failed before an answer arrived.'
    }

    entry.pending = false
    this.notify()
  }

  clear(): void {
    this.#pending?.abort()
    this.selected = null
    this.notify()
  }

  private notify(): void {
    this.dispatchEvent(new Event('change'))
  }
}

export const session = new StationSession()
