/** Server-side only: the browser never calls the API, so no credential can reach the page. */

const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:8000'
const DEFAULT_TIMEOUT_MS = 3000

export interface ApiResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

export interface ProviderStatus {
  name: string
  model: string
  kind: 'remote' | 'local'
  configured: boolean
  reachable: boolean | null
}

export interface HealthResponse {
  status: 'ok' | 'degraded'
  version: string
  env: string
  database: { ok: boolean; error: string | null }
  llm: {
    chain: string[]
    providers: ProviderStatus[]
  }
}

type StatusPredicate = (status: number) => boolean

async function request<T>(
  path: string,
  signal: AbortSignal | undefined,
  acceptStatus: StatusPredicate,
): Promise<ApiResult<T>> {
  let url: string
  try {
    url = new URL(path, API_BASE_URL).toString()
  } catch {
    return { ok: false, status: 0, error: `Invalid API_BASE_URL: ${API_BASE_URL}` }
  }

  let combined = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
    : AbortSignal.timeout(DEFAULT_TIMEOUT_MS)

  try {
    let response = await fetch(url, {
      signal: combined,
      headers: { accept: 'application/json' },
    })

    if (!acceptStatus(response.status)) {
      return { ok: false, status: response.status, error: `API responded ${response.status}` }
    }

    return { ok: true, status: response.status, data: (await response.json()) as T }
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, status: 0, error: `API timed out after ${DEFAULT_TIMEOUT_MS}ms` }
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
export function apiGetHealth(signal?: AbortSignal): Promise<ApiResult<HealthResponse>> {
  return request<HealthResponse>('/api/health', signal, (status) => status === 200 || status === 503)
}
