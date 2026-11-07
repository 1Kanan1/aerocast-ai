/** Server-side only: the browser never calls the API, so no credential can reach the page. */

import type {
  AdvisoryList,
  Health,
  MapLayersResponse,
  StationBrief,
  StationDetailResponse,
  StationHistory,
  StationList,
} from './api-types.ts'
import type { Answer } from './answer.ts'

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8000'
const DEFAULT_TIMEOUT_MS = 3000
const ASK_TIMEOUT_MS = 30_000

export interface ApiResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

type StatusPredicate = (status: number) => boolean

async function request<T>(
  path: string,
  signal: AbortSignal | undefined,
  acceptStatus: StatusPredicate,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ApiResult<T>> {
  let url: string
  try {
    url = new URL(path, API_BASE_URL).toString()
  } catch {
    return { ok: false, status: 0, error: `Invalid API_BASE_URL: ${API_BASE_URL}` }
  }

  let combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs)
  let headers = new Headers(init.headers)
  headers.set('accept', 'application/json')

  try {
    let response = await fetch(url, {
      ...init,
      signal: combined,
      headers,
    })

    if (!acceptStatus(response.status)) {
      return { ok: false, status: response.status, error: `API responded ${response.status}` }
    }

    return { ok: true, status: response.status, data: (await response.json()) as T }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, status: 0, error: `API timed out after ${timeoutMs}ms` }
    }
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

export function apiGet<T>(path: string, signal?: AbortSignal): Promise<ApiResult<T>> {
  return request<T>(path, signal, (status) => status >= 200 && status < 300)
}

/** Health answers 503 when the database is down, and that body is worth rendering. */
export function apiGetHealth(signal?: AbortSignal): Promise<ApiResult<Health>> {
  return request<Health>('/api/health', signal, (status) => status === 200 || status === 503)
}

export function apiGetStations(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResult<StationList>> {
  return apiGet<StationList>(`/api/stations?q=${encodeURIComponent(query)}`, signal)
}

export function apiGetStation(
  icao: string,
  signal?: AbortSignal,
): Promise<ApiResult<StationDetailResponse>> {
  return apiGet<StationDetailResponse>(`/api/stations/${encodeURIComponent(icao)}`, signal)
}

export function apiGetHistory(
  icao: string,
  hours: number,
  signal?: AbortSignal,
): Promise<ApiResult<StationHistory>> {
  return apiGet<StationHistory>(
    `/api/stations/${encodeURIComponent(icao)}/observations?hours=${hours}`,
    signal,
  )
}

export function apiGetBrief(
  icao: string,
  signal?: AbortSignal,
): Promise<ApiResult<StationBrief>> {
  return apiGet<StationBrief>(`/api/stations/${encodeURIComponent(icao)}/brief`, signal)
}

export function apiGetMapLayers(
  bbox: string | null,
  signal?: AbortSignal,
): Promise<ApiResult<MapLayersResponse>> {
  let query = bbox === null ? '' : `?bbox=${encodeURIComponent(bbox)}`
  return apiGet<MapLayersResponse>(`/api/map/layers${query}`, signal)
}

export function apiGetAdvisories(signal?: AbortSignal): Promise<ApiResult<AdvisoryList>> {
  return apiGet<AdvisoryList>('/api/advisories', signal)
}

/** The explanation layer answers questions about one station's facts. */
export function apiAsk(
  icao: string,
  question: string,
  signal?: AbortSignal,
): Promise<ApiResult<Answer>> {
  return request<Answer>(
    '/api/ask',
    signal,
    (status) => status >= 200 && status < 300,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ icao, question }),
    },
    ASK_TIMEOUT_MS,
  )
}
