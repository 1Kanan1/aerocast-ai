import { TypedEventTarget } from 'remix/component'

import type { Answer } from '#app/lib/answer.ts'
import type {
  AreaPayload,
  AreaResponse,
  Bundle,
  BundleAdvisory,
  BundleMetar,
  BundleTaf,
  NearbyStation,
  ResolveResponse,
  ResolveStation,
  ResolveSuggestion,
  StationDetailResponse,
  StationHistory,
} from '#app/lib/api-types.ts'
import { routes } from '#app/routes.ts'

/** Same threshold the envelope applies, so the card can flag a stale report. */
const METAR_STALE_SECONDS = 90 * 60

/** How far the timeline reaches in either direction, in hours. */
export const TIMELINE_HOURS = 48

/** Older than this, the rail is drawn against the newest report instead. */
const TIMELINE_FRESH_MS = 2 * 60 * 60 * 1000

export interface ThreadEntry {
  answer: Answer | null
  pending: boolean
  problem: string | null
  question: string
  refusal: string | null
  stopped: boolean
}

export interface Anchor {
  x: number
  y: number
  /** Screen pixels per nautical mile at the station's latitude and zoom. */
  pxPerNm: number
  /** Degrees the map is turned clockwise from north. */
  bearing: number
}

/** The stations offered after a click on the map, and where it landed. */
export interface NearbyChoice {
  x: number
  y: number
  stations: NearbyStation[]
}

/** A click on the map, treated as a place rather than a station. */
export interface AreaPoint {
  x: number
  y: number
  lat: number
  lon: number
}

/** A question that matched more than one station, waiting for a choice. */
export interface Clarification {
  question: string
  message: string | null
  options: ResolveStation[]
}

export interface HistoryPoint {
  decoded: Record<string, unknown>
  obs_time: string
  category: string | null
  raw: string
}

export interface SelectedStation {
  advisories: BundleAdvisory[]
  ageSeconds: number | null
  basis: string | null
  category: string | null
  error: string | null
  facts: BundleMetar | null
  history: HistoryPoint[]
  icao: string
  lat: number | null
  loading: boolean
  lon: number | null
  name: string
  parseStatus: string | null
  raw: string | null
  source: string
  stale: boolean
  taf: BundleTaf | null
  thread: ThreadEntry[]
  upstreamCategory: string | null
}

/**
 * The map, the station card and the drawer are separate islands, so the
 * selection and the conversation live here rather than in one of them.
 */
export class StationSession extends TypedEventTarget<{ change: Event }> {
  selected: SelectedStation | null = null
  anchor: Anchor | null = null
  clarification: Clarification | null = null
  suggested: ResolveSuggestion[] = []
  /** Share of the weather area with radar echo, 0 to 1, once it is measured. */
  echoShare: number | null = null
  /** Stations around the last empty-map click, waiting for a choice. */
  nearby: NearbyChoice | null = null
  /** The point the map last clicked, when it is read as a place. */
  area: AreaPoint | null = null
  areaLoading = false
  areaError: string | null = null
  areaPayload: AreaPayload | null = null
  areaThread: ThreadEntry[] = []
  /** Hours from now the panel reads: 0 is live, -3 is three hours ago. */
  viewHour = 0
  #pending: AbortController | null = null
  #ask: AbortController | null = null
  #areaPending: AbortController | null = null
  #areaAsk: AbortController | null = null
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

  /** The sketch owns the radar window; the card reads the share from here. */
  setEchoShare(share: number | null): void {
    if (this.echoShare === share) return
    this.echoShare = share
    this.notify()
  }

  /** The map reports where it was clicked and what sits around it. */
  setNearby(choice: NearbyChoice | null): void {
    this.nearby = choice
    this.notify()
  }

  /** The map reports a click as a place to describe. */
  setArea(point: AreaPoint | null): void {
    if (point === null && this.area === null) return
    this.area = point
    this.notify()
  }

  /**
   * Read a clicked point as a place: the stations around it, taken
   * together. A station selection gives way to the area.
   */
  async openArea(point: AreaPoint): Promise<void> {
    this.#areaPending?.abort()
    this.#areaAsk?.abort()
    this.#areaAsk = null
    this.#pending?.abort()
    this.#ask?.abort()
    this.#ask = null
    this.selected = null
    this.clarification = null
    this.suggested = []
    this.setAnchor(null)

    this.area = point
    this.areaPayload = null
    this.areaError = null
    this.areaLoading = true
    this.areaThread = []
    this.notify()

    let controller = new AbortController()
    this.#areaPending = controller

    try {
      let response = await fetch(
        `${routes.area.href()}?lat=${point.lat.toFixed(4)}&lon=${point.lon.toFixed(4)}`,
        { headers: { accept: 'application/json' }, signal: controller.signal },
      )
      let payload = (await response
        .json()
        .catch(() => null)) as AreaResponse | null

      if (!response.ok || payload === null) {
        throw new Error(`area ${response.status}`)
      }

      this.areaPayload = payload.data
    } catch {
      if (controller.signal.aborted) return
      this.areaError = 'The stations around this point could not be read.'
    }

    if (controller.signal.aborted) return
    this.areaLoading = false
    this.notify()
  }

  /** Close the area and forget its conversation. */
  closeArea(): void {
    this.#areaPending?.abort()
    this.#areaAsk?.abort()
    this.#areaAsk = null
    this.area = null
    this.areaPayload = null
    this.areaError = null
    this.areaLoading = false
    this.areaThread = []
    this.notify()
  }

  /** Ask the area's stations, each still speaking for itself. */
  async askArea(question: string): Promise<void> {
    let point = this.area
    let text = question.trim()
    if (
      point === null ||
      text === '' ||
      this.areaThread.some((entry) => entry.pending)
    ) {
      return
    }

    let entry: ThreadEntry = {
      answer: null,
      pending: true,
      problem: null,
      question: text,
      refusal: null,
      stopped: false,
    }
    this.areaThread.push(entry)
    this.notify()

    let controller = new AbortController()
    this.#areaAsk = controller

    try {
      let response = await fetch(routes.areaAsk.href(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          lat: point.lat,
          lon: point.lon,
          question: text,
        }),
        signal: controller.signal,
      })
      let payload = (await response.json().catch(() => null)) as
        | (Partial<Answer> & { error?: string })
        | null

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
          notice: payload.notice ?? null,
        }
      } else {
        entry.problem = 'The explanation layer returned an unexpected answer.'
      }
    } catch {
      if (controller.signal.aborted) {
        entry.pending = false
        entry.stopped = true
        if (this.#areaAsk === controller) this.#areaAsk = null
        this.notify()
        return
      }
      entry.problem = 'The request failed before an answer arrived.'
    }

    if (this.#areaAsk === controller) this.#areaAsk = null
    entry.pending = false
    this.notify()
  }

  /** Hours from now the panel is reading: 0 is live, -3 is three hours ago. */
  setViewHour(hour: number): void {
    let next = Math.max(
      -TIMELINE_HOURS,
      Math.min(TIMELINE_HOURS, Math.round(hour)),
    )
    if (this.viewHour === next) return
    this.viewHour = next
    this.notify()
  }

  /**
   * The clock the timeline is drawn against. While the report is current
   * that is the wall clock; once the record is stale it is the newest report,
   * so the rail lands on hours the station actually has.
   */
  get timelineBase(): number {
    let observed = this.selected?.facts?.observed_at
    let at = observed === undefined ? NaN : Date.parse(observed)
    let now = Date.now()
    if (Number.isNaN(at)) return now
    return now - at > TIMELINE_FRESH_MS ? at : now
  }

  async select(
    icao: string,
    suggested: ResolveSuggestion[] = [],
  ): Promise<void> {
    let previous = this.selected
    let thread = previous?.icao === icao ? previous.thread : []

    this.clarification = null
    this.suggested = suggested
    this.viewHour = 0
    this.#pending?.abort()
    this.#ask?.abort()
    this.#ask = null
    // Choosing a station leaves the area behind: the two panels never
    // describe different things at once.
    this.#areaPending?.abort()
    this.#areaAsk?.abort()
    this.#areaAsk = null
    this.area = null
    this.areaLoading = false
    this.areaError = null
    this.areaPayload = null
    this.areaThread = []
    let controller = new AbortController()
    this.#pending = controller

    this.selected = {
      advisories: [],
      ageSeconds: null,
      basis: null,
      category: null,
      error: null,
      facts: null,
      history: [],
      icao,
      lat: null,
      loading: true,
      lon: null,
      name: icao,
      parseStatus: null,
      raw: null,
      source: 'aviationweather.gov',
      stale: false,
      taf: null,
      thread,
      upstreamCategory: null,
    }
    this.notify()

    try {
      let signal = controller.signal
      let [detailResponse, briefResponse, historyResponse] = await Promise.all([
        fetch(routes.detail.href({ icao }), {
          headers: { accept: 'application/json' },
          signal,
        }),
        fetch(routes.brief.href({ icao }), {
          headers: { accept: 'application/json' },
          signal,
        }),
        fetch(routes.history.href({ icao }), {
          headers: { accept: 'application/json' },
          signal,
        }),
      ])

      if (!detailResponse.ok || !briefResponse.ok) {
        throw new Error(`station ${detailResponse.status}`)
      }
      if (signal.aborted) return

      let detail = (await detailResponse.json()) as StationDetailResponse
      let brief = (await briefResponse.json()) as { data: Bundle }
      let history = historyResponse.ok
        ? ((await historyResponse.json()) as StationHistory)
        : { data: [] }

      let station = brief.data.stations[0]
      let metar = station?.metar ?? null
      let row = detail.data.metar
      let age = metar?.age_seconds ?? null

      this.selected = {
        ...this.selected,
        name: station?.name ?? icao,
        lat: detail.data.station.lat,
        lon: detail.data.station.lon,
        category: metar?.flight_category.value ?? null,
        basis: metar?.flight_category.basis ?? null,
        facts: metar,
        raw: metar?.raw ?? null,
        ageSeconds: age,
        stale: age !== null && age > METAR_STALE_SECONDS,
        advisories: station?.advisories ?? [],
        taf: station?.taf ?? null,
        history: history.data ?? [],
        parseStatus: row?.parse_status ?? null,
        upstreamCategory: row?.upstream_category ?? null,
        source: detail.meta.source,
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
    if (
      selected === null ||
      text === '' ||
      selected.thread.some((entry) => entry.pending)
    ) {
      return
    }

    let entry: ThreadEntry = {
      answer: null,
      pending: true,
      problem: null,
      question: text,
      refusal: null,
      stopped: false,
    }
    selected.thread.push(entry)
    this.notify()

    let controller = new AbortController()
    this.#ask = controller

    let form = new FormData()
    form.set('question', text)

    try {
      let response = await fetch(routes.ask.href({ icao: selected.icao }), {
        method: 'POST',
        body: form,
        headers: { accept: 'application/json' },
        signal: controller.signal,
      })
      let payload = (await response.json().catch(() => null)) as
        | (Partial<Answer> & { error?: string })
        | null

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
          notice: payload.notice ?? null,
        }
      } else {
        entry.problem = 'The explanation layer returned an unexpected answer.'
      }
    } catch {
      if (controller.signal.aborted) {
        entry.pending = false
        entry.stopped = true
        if (this.#ask === controller) this.#ask = null
        this.notify()
        return
      }
      entry.problem = 'The request failed before an answer arrived.'
    }

    if (this.#ask === controller) this.#ask = null
    entry.pending = false
    this.notify()
  }

  /** Stop the answer in flight; the entry stays in the thread as stopped. */
  cancelAsk(): void {
    let controller = this.#ask ?? this.#areaAsk
    if (controller === null) return

    controller.abort()
    if (this.#ask === controller) this.#ask = null
    if (this.#areaAsk === controller) this.#areaAsk = null

    let thread = this.selected?.thread ?? this.areaThread
    let entry = thread.find((item) => item.pending)
    if (entry) {
      entry.pending = false
      entry.stopped = true
    }
    this.notify()
  }

  /**
   * Ask-first: resolve the place in the question before any model call.
   * A station is asked directly, several matches wait for a choice, and no
   * match falls back to the station already on screen.
   */
  async askQuestion(question: string): Promise<void> {
    let text = question.trim()
    if (text === '') return

    // An open area answers for the place the reader clicked, not for a
    // station the resolver would have to guess.
    if (this.area !== null) {
      await this.askArea(text)
      return
    }

    this.clarification = null
    this.notify()

    let response = await fetch(
      `${routes.resolve.href()}?q=${encodeURIComponent(text)}`,
      { headers: { accept: 'application/json' } },
    )
    let payload = response.ok
      ? ((await response.json()) as ResolveResponse)
      : null

    if (payload?.station) {
      await this.select(payload.station.icao, payload.suggested)
      await this.ask(text)
      return
    }

    if (payload !== null && payload.candidates.length > 0) {
      this.#pending?.abort()
      this.#ask?.abort()
      this.#ask = null
      this.selected = null
      this.suggested = []
      this.setAnchor(null)
      this.clarification = {
        question: text,
        message: payload.message,
        options: payload.candidates,
      }
      this.notify()
      return
    }

    if (this.selected !== null) {
      await this.ask(text)
      return
    }

    this.clarification = {
      question: text,
      message: payload?.message ?? 'No station matches that question.',
      options: [],
    }
    this.notify()
  }

  /** Answer the pending clarification with one of its stations. */
  choose(icao: string): void {
    let pending = this.clarification
    if (pending === null) return

    this.clarification = null
    void this.select(icao).then(() => this.ask(pending.question))
  }

  /** Drop the turn at `index` and every turn after it. */
  discardFrom(index: number): void {
    let selected = this.selected
    if (selected === null || index < 0 || index >= selected.thread.length) {
      return
    }

    this.#ask?.abort()
    this.#ask = null
    selected.thread.splice(index)
    this.notify()
  }

  clear(): void {
    this.#pending?.abort()
    this.#ask?.abort()
    this.#ask = null
    this.#areaPending?.abort()
    this.#areaAsk?.abort()
    this.#areaAsk = null
    this.selected = null
    this.clarification = null
    this.nearby = null
    this.area = null
    this.areaLoading = false
    this.areaError = null
    this.areaPayload = null
    this.areaThread = []
    this.suggested = []
    this.viewHour = 0
    this.setAnchor(null)
    this.notify()
  }

  private notify(): void {
    this.dispatchEvent(new Event('change'))
  }
}

export const session = new StationSession()
