import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '#app/routes.ts'
import {
  envelope,
  get,
  mockApi,
  mockApiDown,
  META,
  STATION,
} from './test-helpers.ts'

const BRIEF = {
  data: {
    stations: [
      {
        icao: 'KSFO',
        name: STATION.name,
        lat: STATION.lat,
        lon: STATION.lon,
        metar: null,
        taf: null,
        advisories: [],
      },
    ],
    definitions: {},
    brief_hash: 'sha256:abc',
  },
  meta: META,
}

describe('map page', () => {
  it('renders the workspace with the islands the page needs', async (t) => {
    mockApi(t, {
      '/api/map/layers': () => Response.json(envelope({ advisories: [] })),
    })

    let response = await get(routes.home.href())
    let html = await response.text()

    assert.equal(response.status, 200)
    assert.match(html, /AEROCAST/)
    assert.match(html, /MapIsland/)
    assert.match(html, /AskBar/)
    assert.match(html, /AnswerPanel/)
    assert.match(html, /Ask about the weather/)
    assert.match(html, /StationPopup/)
    assert.match(html, /Not for flight planning/)
  })

  it('leaves search to the ask bar instead of the navbar', async (t) => {
    mockApi(t, {
      '/api/map/layers': () => Response.json(envelope({ advisories: [] })),
    })

    let html = await (await get(routes.home.href())).text()

    assert.doesNotMatch(html, /aria-label="Search stations"/)
    assert.doesNotMatch(html, /id="station-search"/)
    assert.match(html, /Ask about the weather anywhere/)
  })

  it('proxies layer requests same-origin', async (t) => {
    let layers = envelope({ advisories: [] })
    mockApi(t, { '/api/map/layers': () => Response.json(layers) })

    let response = await get(`${routes.layers.href()}?bbox=-123,37,-122,38`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), layers)
  })

  it('proxies station search same-origin', async (t) => {
    mockApi(t, { '/api/stations': () => Response.json(envelope([STATION])) })

    let response = await get(`${routes.search.href()}?q=sfo`)

    assert.equal(response.status, 200)
    assert.match(JSON.stringify(await response.json()), /KSFO/)
  })

  it('proxies the brief the card reads', async (t) => {
    mockApi(t, {
      '/api/stations/KSFO/brief': () => Response.json(BRIEF),
    })

    let response = await get(routes.brief.href({ icao: 'KSFO' }))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), BRIEF)
  })

  it('proxies the detail and history the card reads', async (t) => {
    let detail = envelope({
      station: STATION,
      metar: null,
      taf: null,
      advisories: [],
    })
    let history = envelope([])
    mockApi(t, {
      '/api/stations/KSFO': () => Response.json(detail),
      '/api/stations/KSFO/observations': () => Response.json(history),
    })

    assert.equal((await get(routes.detail.href({ icao: 'KSFO' }))).status, 200)
    assert.equal((await get(routes.history.href({ icao: 'KSFO' }))).status, 200)
  })

  it('answers 502 when a proxy cannot reach the API', async (t) => {
    mockApiDown(t)

    assert.equal((await get(routes.layers.href())).status, 502)
    assert.equal((await get(routes.brief.href({ icao: 'KSFO' }))).status, 502)
    assert.equal((await get(routes.search.href())).status, 502)
    assert.equal((await get(routes.detail.href({ icao: 'KSFO' }))).status, 502)
    assert.equal((await get(routes.history.href({ icao: 'KSFO' }))).status, 502)
  })
})
