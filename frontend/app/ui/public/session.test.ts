import * as assert from 'remix/assert'
import type { TestContext } from 'remix/test'
import { describe, it } from 'remix/test'

import { StationSession } from './session.ts'
import type { Anchor } from './session.ts'

const METAR = {
  raw: 'METAR KSFO 052156Z 03003KT 10SM SCT200 18/13 A3008',
  observed_at: '2026-11-05T21:56:00Z',
  age_seconds: 240,
  flight_category: {
    value: 'VFR',
    basis: 'no ceiling, visibility 10 SM',
  },
}

const BRIEF = {
  data: {
    stations: [
      {
        name: 'San Francisco Intl',
        metar: METAR,
        taf: null,
        advisories: [{ hazard: 'IFR' }, { hazard: 'TURB' }],
      },
    ],
  },
}

const DETAIL = {
  data: {
    station: {
      icao: 'KSFO',
      name: 'San Francisco Intl',
      state: 'CA',
      lat: 37.6196,
      lon: -122.3656,
      elev_m: 4,
    },
    metar: { parse_status: 'ok', upstream_category: 'VFR' },
  },
  meta: { source: 'aviationweather.gov' },
}

const HISTORY = {
  data: [{ obs_time: '2026-11-05T21:56:00Z', decoded: {} }],
  meta: {},
}

function stationApi(path: string): Response {
  if (path.includes('/observations')) return Response.json(HISTORY)
  if (path.includes('/brief')) return Response.json(BRIEF)
  return Response.json(DETAIL)
}

function mockFetch(
  t: TestContext,
  handler: (path: string) => Response | Promise<Response>,
) {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    let path =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
    return handler(path)
  })
}

describe('station session', () => {
  it('loads facts, forecast and history for the selected station', async (t) => {
    mockFetch(t, stationApi)
    let session = new StationSession()

    await session.select('KSFO')

    assert.equal(session.selected?.name, 'San Francisco Intl')
    assert.equal(session.selected?.lat, 37.6196)
    assert.equal(session.selected?.lon, -122.3656)
    assert.equal(session.selected?.category, 'VFR')
    assert.equal(session.selected?.facts?.raw, METAR.raw)
    assert.equal(session.selected?.advisories.length, 2)
    assert.equal(session.selected?.history.length, 1)
    assert.equal(session.selected?.source, 'aviationweather.gov')
    assert.equal(session.selected?.parseStatus, 'ok')
    assert.equal(session.selected?.loading, false)
  })

  it('flags an old observation as stale', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/brief')
        ? Response.json({
            data: {
              stations: [
                {
                  ...BRIEF.data.stations[0],
                  metar: { ...METAR, age_seconds: 7200 },
                },
              ],
            },
          })
        : stationApi(path),
    )
    let session = new StationSession()

    await session.select('KSFO')

    assert.equal(session.selected?.stale, true)
  })

  it('reports a failed station instead of an empty card', async (t) => {
    mockFetch(t, () => new Response('nope', { status: 502 }))
    let session = new StationSession()

    await session.select('KSFO')

    assert.match(session.selected?.error ?? '', /unavailable/)
    assert.equal(session.selected?.facts, null)
  })

  it('keeps the thread with the station it belongs to', async (t) => {
    mockFetch(t, stationApi)
    let session = new StationSession()

    await session.select('KSFO')
    let first = session.selected?.thread
    await session.select('KSFO')
    assert.equal(session.selected?.thread, first)

    await session.select('KJFK')
    assert.equal(session.selected?.thread.length, 0)
    assert.equal(session.selected?.icao, 'KJFK')
  })

  it('drops the old station when a question needs a choice', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/resolve')
        ? Response.json({
            station: null,
            candidates: [
              {
                icao: 'KSPI',
                name: 'Springfield Capital',
                state: 'IL',
                lat: 39.84,
                lon: -89.68,
              },
            ],
            suggested: [],
            message: '“springfield” matches several stations.',
          })
        : stationApi(path),
    )
    let session = new StationSession()
    await session.select('KSFO')

    await session.askQuestion('weather in Springfield')

    assert.equal(session.selected, null)
    assert.equal(session.clarification?.options[0]?.icao, 'KSPI')
  })

  it('records an unavailable explanation on the entry', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/ask')
        ? Response.json({ error: 'not available' }, { status: 503 })
        : stationApi(path),
    )
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('Why is the ceiling low?')

    let entry = session.selected?.thread[0]
    assert.equal(entry?.question, 'Why is the ceiling low?')
    assert.match(entry?.problem ?? '', /not available/)
    assert.equal(entry?.pending, false)
  })

  it('records a validated answer when one arrives', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/ask')
        ? Response.json({
            summary: 'KSFO is VFR.',
            claims: [
              {
                text: 'Visibility is 10 SM.',
                refs: ['metar.KSFO.visibility'],
              },
            ],
            caveats: [],
            refusal: null,
            notice: null,
          })
        : stationApi(path),
    )
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('How is the visibility?')

    let entry = session.selected?.thread[0]
    assert.equal(entry?.answer?.summary, 'KSFO is VFR.')
    assert.equal(entry?.answer?.claims[0]?.refs[0], 'metar.KSFO.visibility')
  })

  it('keeps a fallback notice separate from the summary', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/ask')
        ? Response.json({
            summary: 'KSFO is reporting VFR conditions.',
            claims: [],
            caveats: [],
            refusal: null,
            notice:
              'Showing the decoded facts for this station. A generated explanation was not available for this question.',
          })
        : stationApi(path),
    )
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('How is the visibility?')

    let entry = session.selected?.thread[0]
    assert.equal(entry?.answer?.claims.length, 0)
    assert.match(entry?.answer?.notice ?? '', /decoded facts/)
  })

  it('ignores an empty question and clears the selection', async (t) => {
    mockFetch(t, stationApi)
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('   ')
    session.clear()

    assert.equal(session.selected, null)
  })

  it('stops an answer in flight', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      async (input: RequestInfo | URL, init?: RequestInit) => {
        let path =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url

        if (path.includes('/ask')) {
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(new DOMException('Aborted', 'AbortError'))
            })
          })
        }

        return stationApi(path)
      },
    )
    let session = new StationSession()
    await session.select('KSFO')

    let asking = session.ask('What is the ceiling?')
    session.cancelAsk()
    await asking

    let entry = session.selected?.thread[0]
    assert.equal(entry?.pending, false)
    assert.equal(entry?.stopped, true)
  })

  it('discards a turn and everything after it', async (t) => {
    mockFetch(t, (path) =>
      path.includes('/ask')
        ? Response.json({ error: 'not available' }, { status: 503 })
        : stationApi(path),
    )
    let session = new StationSession()
    await session.select('KSFO')
    await session.ask('How is the visibility?')
    await session.ask('What is the ceiling?')
    await session.ask('What is the wind doing?')

    session.discardFrom(1)

    assert.deepEqual(
      session.selected?.thread.map((entry) => entry.question),
      ['How is the visibility?'],
    )
  })

  it('reports the dot anchor until the listener unsubscribes', () => {
    let session = new StationSession()
    let seen: (Anchor | null)[] = []
    let stop = session.onAnchor((anchor) => seen.push(anchor))

    session.setAnchor({ x: 10, y: 20, pxPerNm: 1.4 })
    session.setAnchor(null)
    stop()
    session.setAnchor({ x: 30, y: 40, pxPerNm: 1.4 })

    assert.deepEqual(seen, [{ x: 10, y: 20, pxPerNm: 1.4 }, null])
    assert.deepEqual(session.anchor, { x: 30, y: 40, pxPerNm: 1.4 })
  })

  it('drops the anchor when the card is cleared', async (t) => {
    mockFetch(t, stationApi)
    let session = new StationSession()
    await session.select('KSFO')
    session.setAnchor({ x: 10, y: 20, pxPerNm: 1.4 })

    session.clear()

    assert.equal(session.anchor, null)
  })
})
