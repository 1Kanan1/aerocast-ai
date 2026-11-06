import type { TestContext } from 'remix/test'

import { router } from '../router.ts'

export const ORIGIN = 'http://localhost'

export const META = {
  source: 'aviationweather.gov',
  fetched_at: '2026-11-05T22:00:00Z',
  observed_at: '2026-11-05T21:56:00Z',
  valid_to: null,
  age_seconds: 240,
  stale: false,
}

export const STATION = {
  icao: 'KSFO',
  name: 'San Francisco Intl',
  state: 'CA',
  lat: 37.6,
  lon: -122.3,
  elev_m: 4,
}

export function envelope(data: unknown, meta: object = META): object {
  return { data, meta }
}

/** Answers the API paths an action calls, and 404s the rest. */
export function mockApi(
  t: TestContext,
  handlers: Record<string, () => Response>,
) {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    let url = new URL(
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    )
    let handler = handlers[url.pathname]
    return handler
      ? handler()
      : new Response('{"detail":"Not Found"}', { status: 404 })
  })
}

export function mockApiDown(t: TestContext) {
  t.mock.method(globalThis, 'fetch', async () => {
    throw new TypeError('fetch failed')
  })
}

export async function get(path: string): Promise<Response> {
  return router.fetch(new URL(path, ORIGIN))
}
