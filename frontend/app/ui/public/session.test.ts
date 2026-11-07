import * as assert from 'remix/assert'
import type { TestContext } from 'remix/test'
import { describe, it } from 'remix/test'

import { StationSession } from './session.ts'
import type { Anchor } from './session.ts'

const BRIEF = {
  data: {
    stations: [
      {
        name: 'San Francisco Intl',
        metar: {
          raw: 'METAR KSFO 052156Z 03003KT 10SM SCT200 18/13 A3008',
          age_seconds: 240,
          flight_category: {
            value: 'VFR',
            basis: 'no ceiling, visibility 10 SM',
          },
        },
        advisories: [{ hazard: 'IFR' }, { hazard: 'TURB' }],
      },
    ],
  },
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
  it('loads the selected station from the brief proxy', async (t) => {
    mockFetch(t, (path) => {
      assert.match(path, /\/api\/stations\/KSFO\/brief/)
      return Response.json(BRIEF)
    })
    let session = new StationSession()

    await session.select('KSFO')

    assert.equal(session.selected?.name, 'San Francisco Intl')
    assert.equal(session.selected?.category, 'VFR')
    assert.equal(session.selected?.facts?.raw, BRIEF.data.stations[0].metar.raw)
    assert.equal(session.selected?.advisories, 2)
    assert.equal(session.selected?.loading, false)
  })

  it('flags an old observation as stale', async (t) => {
    mockFetch(t, () =>
      Response.json({
        data: {
          stations: [
            {
              name: 'San Francisco Intl',
              metar: {
                ...BRIEF.data.stations[0].metar,
                age_seconds: 7200,
              },
              advisories: [],
            },
          ],
        },
      }),
    )
    let session = new StationSession()

    await session.select('KSFO')

    assert.equal(session.selected?.stale, true)
  })

  it('reports a failed brief instead of an empty panel', async (t) => {
    mockFetch(t, () => new Response('nope', { status: 502 }))
    let session = new StationSession()

    await session.select('KSFO')

    assert.match(session.selected?.error ?? '', /unavailable/)
    assert.equal(session.selected?.facts, null)
  })

  it('keeps the thread with the station it belongs to', async (t) => {
    mockFetch(t, () => Response.json(BRIEF))
    let session = new StationSession()

    await session.select('KSFO')
    let first = session.selected?.thread
    await session.select('KSFO')
    assert.equal(session.selected?.thread, first)

    await session.select('KJFK')
    assert.equal(session.selected?.thread.length, 0)
    assert.equal(session.selected?.icao, 'KJFK')
  })

  it('records an unavailable explanation on the entry', async (t) => {
    mockFetch(t, (path) => {
      if (path.includes('/brief')) return Response.json(BRIEF)
      return Response.json({ error: 'not available' }, { status: 503 })
    })
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('Why is the ceiling low?')

    let entry = session.selected?.thread[0]
    assert.equal(entry?.question, 'Why is the ceiling low?')
    assert.match(entry?.problem ?? '', /not available/)
    assert.equal(entry?.pending, false)
  })

  it('records a validated answer when one arrives', async (t) => {
    mockFetch(t, (path) => {
      if (path.includes('/brief')) return Response.json(BRIEF)
      return Response.json({
        summary: 'KSFO is VFR.',
        claims: [{ text: 'Visibility is 10 SM.', refs: ['metar.KSFO.visibility'] }],
        caveats: [],
        refusal: null,
      })
    })
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('How is the visibility?')

    let entry = session.selected?.thread[0]
    assert.equal(entry?.answer?.summary, 'KSFO is VFR.')
    assert.equal(entry?.answer?.claims[0]?.refs[0], 'metar.KSFO.visibility')
  })

  it('ignores an empty question and clears the selection', async (t) => {
    mockFetch(t, () => Response.json(BRIEF))
    let session = new StationSession()
    await session.select('KSFO')

    await session.ask('   ')
    session.clear()

    assert.equal(session.selected, null)
  })

  it('reports the dot anchor until the listener unsubscribes', () => {
    let session = new StationSession()
    let seen: (Anchor | null)[] = []
    let stop = session.onAnchor((anchor) => seen.push(anchor))

    session.setAnchor({ x: 10, y: 20 })
    session.setAnchor(null)
    stop()
    session.setAnchor({ x: 30, y: 40 })

    assert.deepEqual(seen, [{ x: 10, y: 20 }, null])
    assert.deepEqual(session.anchor, { x: 30, y: 40 })
  })
})
