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
  ResolveCandidate,
  ResolveResponse,
  ResolveSuggestion,
  StationDetailResponse,
  StationHistory,
} from '#app/lib/api-types.ts'
import { parseCoordinates } from '#app/lib/public/coordinates.ts'
import { TIMELINE_HOURS } from '#app/lib/public/timeline.ts'
import { routes } from '#app/routes.ts'

/** Same threshold the envelope applies, so the card can flag a stale report. */
const METAR_STALE_SECONDS = 90 * 60

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
  lat: number
  lon: number
  /** City label when opened from a place search instead of a raw click. */
  label?: string
  /** A searched coordinate or city: the map should travel to it once. */
  focus?: boolean
}

/** A question that matched more than one station, waiting for a choice. */
export interface Clarification {
  question: string
  message: string | null
  options: ResolveCandidate[]
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
  definitions: Record<string, string>
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

export interface UrlSelection {
  station?: string
  hour?: number
  area?: AreaPoint
}

/** Parses `?station=KDEN&hour=-2` or `?area=39.7500,-104.9000` from a URL query. */
export function parseStateFromSearch(search: string): UrlSelection {
  let params = new URLSearchParams(search)
  let rawStation = params.get('station')?.trim().toUpperCase()
  if (rawStation && /^[A-Z0-9]{3,4}$/.test(rawStation)) {
    let rawHour = params.get('hour')
    let parsedHour = rawHour === null ? 0 : Number(rawHour)
    let hour = Number.isFinite(parsedHour)
      ? Math.max(
          -TIMELINE_HOURS,
          Math.min(TIMELINE_HOURS, Math.round(parsedHour)),
        )
      : 0
    return { station: rawStation, hour }
  }

  let rawArea = params.get('area')?.trim()
  if (rawArea) {
    let parts = rawArea.split(',')
    if (parts.length === 2) {
      let lat = Number(parts[0])
      let lon = Number(parts[1])
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
      ) {
        return { area: { lat, lon, focus: true } }
      }
    }
  }

  return {}
}

/**
 * Builds the query string representing the active station/hour or area.
 * Keeps a literal comma in `area=lat,lon` instead of percent-encoding `%2C`.
 */
export function buildSearchForState(
  stationIcao: string | null,
  area: AreaPoint | null,
  viewHour: number,
): string {
  if (stationIcao !== null) {
    let query = `?station=${encodeURIComponent(stationIcao)}`
    return viewHour === 0 ? query : `${query}&hour=${viewHour}`
  }
  if (area !== null) {
    return `?area=${area.lat.toFixed(4)},${area.lon.toFixed(4)}`
  }
  return ''
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
  /** Active citation ref highlighted in the panel. */
  highlightedRef: string | null = null
  #threads = new Map<string, ThreadEntry[]>()
  #pending: AbortController | null = null
  #ask: AbortController | null = null
  #areaPending: AbortController | null = null
  #areaAsk: AbortController | null = null
  #anchorListeners = new Set<(anchor: Anchor | null, moving: boolean) => void>()
  #settledListeners = new Set<() => void>()

  /** The map owns projection, so it reports the dot's screen point here. */
  onAnchor(
    listener: (anchor: Anchor | null, moving: boolean) => void,
  ): () => void {
    this.#anchorListeners.add(listener)
    return () => {
      this.#anchorListeners.delete(listener)
    }
  }

  setAnchor(anchor: Anchor | null): void {
    this.anchor = anchor
    for (let listener of this.#anchorListeners) listener(anchor, false)
  }

  /** A camera gesture moved the anchor: the map is on its way somewhere. */
  moveAnchor(anchor: Anchor | null): void {
    this.anchor = anchor
    for (let listener of this.#anchorListeners) listener(anchor, true)
  }

  /** The camera has stopped: the one moment a drifting drawing is redrawn. */
  onAnchorSettled(listener: () => void): () => void {
    this.#settledListeners.add(listener)
    return () => {
      this.#settledListeners.delete(listener)
    }
  }

  settleAnchor(): void {
    for (let listener of this.#settledListeners) listener()
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

  /** Highlight a cited bundle ref in the panel. */
  highlightRef(refPath: string | null): void {
    if (this.highlightedRef === refPath) return
    this.highlightedRef = refPath
    this.notify()
  }

  /** Restore a station or area selection from the current browser URL. */
  async syncFromUrl(): Promise<void> {
    if (typeof window === 'undefined') return
    let state = parseStateFromSearch(window.location.search)
    if (state.station) {
      await this.select(state.station)
      if (state.hour) this.setViewHour(state.hour)
    } else if (state.area) {
      await this.openArea(state.area)
    }
  }

  /** Retry fetching the currently selected station after an error. */
  async retryStation(): Promise<void> {
    if (this.selected === null) return
    await this.select(this.selected.icao, this.suggested)
  }

  /** Retry fetching the currently open area after an error. */
  async retryArea(): Promise<void> {
    if (this.area === null) return
    await this.openArea(this.area)
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
    this.highlightedRef = null
    this.clarification = null
    this.suggested = []
    this.setAnchor(null)

    this.area = point
    this.areaPayload = null
    this.areaError = null
    this.areaLoading = true
    this.areaThread = []
    this.viewHour = 0
    this.syncUrl()
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
    this.highlightedRef = null
    this.syncUrl()
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
        | (Partial<Answer> & { error?: string; elapsed_ms?: number | null })
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
          model: payload.model ?? null,
          elapsedMs: payload.elapsed_ms ?? null,
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
    this.syncUrl()
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
    let code = icao.toUpperCase()
    let thread = this.#threads.get(code)
    if (thread === undefined) {
      thread = []
      this.#threads.set(code, thread)
    }

    this.clarification = null
    this.highlightedRef = null
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
      definitions: {},
      error: null,
      facts: null,
      history: [],
      icao: code,
      lat: null,
      loading: true,
      lon: null,
      name: code,
      parseStatus: null,
      raw: null,
      source: 'aviationweather.gov',
      stale: false,
      taf: null,
      thread,
      upstreamCategory: null,
    }
    this.syncUrl()
    this.notify()

    try {
      let signal = controller.signal
      let [detailResponse, briefResponse, historyResponse] = await Promise.all([
        fetch(routes.detail.href({ icao: code }), {
          headers: { accept: 'application/json' },
          signal,
        }),
        fetch(routes.brief.href({ icao: code }), {
          headers: { accept: 'application/json' },
          signal,
        }),
        fetch(routes.history.href({ icao: code }), {
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
        name: station?.name ?? code,
        lat: detail.data.station.lat,
        lon: detail.data.station.lon,
        category: metar?.flight_category.value ?? null,
        basis: metar?.flight_category.basis ?? null,
        definitions: brief.data.definitions ?? {},
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
        | (Partial<Answer> & { error?: string; elapsed_ms?: number | null })
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
          model: payload.model ?? null,
          elapsedMs: payload.elapsed_ms ?? null,
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
   * Ask-first: when a station or area is already open, every message stays
   * locked to that location. When nothing is open, resolve coordinates, a
   * station code, or a city name first.
   */
  async askQuestion(question: string): Promise<void> {
    let text = question.trim()
    if (text === '') return

    if (this.area !== null) {
      await this.askArea(text)
      return
    }

    if (this.selected !== null) {
      await this.ask(text)
      return
    }

    // A coordinate is a place, the same as a click: it opens the weather
    // around that point instead of resolving to a station next to it.
    let coordinates = parseCoordinates(text)
    if (coordinates !== null) {
      await this.openArea({ ...coordinates, focus: true })
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
      if (payload.station.ask !== false) {
        await this.ask(text)
      }
      return
    }

    if (payload?.area) {
      await this.openArea({
        lat: payload.area.lat,
        lon: payload.area.lon,
        label: payload.area.label,
        focus: true,
      })
      if (payload.area.ask) {
        await this.askArea(text)
      }
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

    this.clarification = {
      question: text,
      message: payload?.message ?? 'No station or city matches that question.',
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

  /** The same for the area's thread, so a prompt can be rewritten there. */
  discardAreaFrom(index: number): void {
    if (index < 0 || index >= this.areaThread.length) return

    this.#areaAsk?.abort()
    this.#areaAsk = null
    this.areaThread.splice(index)
    this.notify()
  }

  /**
   * Reset transient map state when navigating away from the map route. Keeps
   * saved station threads and never mutates browser history so soft navigations
   * back to `/` hydrate cleanly against server HTML.
   */
  detach(): void {
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
    this.highlightedRef = null
    this.anchor = null
  }

  clear(): void {
    this.detach()
    this.setAnchor(null)
    this.syncUrl()
    this.notify()
  }

  private syncUrl(): void {
    if (typeof window === 'undefined' || !window.history) return
    if (window.location.pathname !== routes.home.href()) return
    let nextSearch = buildSearchForState(
      this.selected?.icao ?? null,
      this.area,
      this.viewHour,
    )
    if (window.location.search === nextSearch) return
    let target = `${window.location.pathname}${nextSearch}${window.location.hash}`

    // history.replaceState clears Navigation API entry state, which strips
    // Remix's `$rmx` marker and breaks browser Back/Forward traverses. Capture
    // and restore it with the updated `src`.
    let nav = (
      window as Window & {
        navigation?: {
          currentEntry?: { getState?: () => unknown } | null
          updateCurrentEntry?: (options: { state: unknown }) => void
        }
      }
    ).navigation
    let prevNavState = nav?.currentEntry?.getState?.()

    window.history.replaceState(window.history.state, '', target)

    if (
      nav?.updateCurrentEntry &&
      prevNavState !== null &&
      typeof prevNavState === 'object' &&
      '$rmx' in prevNavState
    ) {
      nav.updateCurrentEntry({
        state: { ...prevNavState, src: window.location.href },
      })
    }
  }

  private notify(): void {
    this.dispatchEvent(new Event('change'))
  }
}

export const session = new StationSession()
