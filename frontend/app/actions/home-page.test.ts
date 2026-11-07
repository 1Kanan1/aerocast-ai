import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '../routes.ts'
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
      '/api/stations': () => Response.json(envelope([STATION])),
      '/api/map/layers': () =>
        Response.json(envelope({ stations: [], advisories: [] })),
    })

    let response = await get(routes.home.href())
    let html = await response.text()

    assert.equal(response.status, 200)
    assert.match(html, /AEROCAST/)
    assert.match(html, /MapIsland/)
    assert.match(html, /ChatSidebar/)
    assert.match(html, /StationPopup/)
    assert.match(html, /Not for navigation/)
    assert.match(html, /Not for flight planning/)
  })

  it('server-renders search results as station links', async (t) => {
    mockApi(t, {
      '/api/stations': () => Response.json(envelope([STATION])),
      '/api/map/layers': () =>
        Response.json(envelope({ stations: [], advisories: [] })),
    })

    let html = await (await get(`${routes.home.href()}?q=sfo`)).text()

    assert.match(html, /href="\/stations\/KSFO"/)
    assert.match(html, /San Francisco Intl/)
  })

  it('proxies layer requests same-origin', async (t) => {
    let layers = envelope({ stations: [], advisories: [] })
    mockApi(t, { '/api/map/layers': () => Response.json(layers) })

    let response = await get(`${routes.layers.href()}?bbox=-123,37,-122,38`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), layers)
  })

  it('proxies the brief the popup reads', async (t) => {
    mockApi(t, {
      '/api/stations/KSFO/brief': () => Response.json(BRIEF),
    })

    let response = await get(routes.brief.href({ icao: 'KSFO' }))

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), BRIEF)
  })

  it('answers 502 when a proxy cannot reach the API', async (t) => {
    mockApiDown(t)

    assert.equal((await get(routes.layers.href())).status, 502)
    assert.equal(
      (await get(routes.brief.href({ icao: 'KSFO' }))).status,
      502,
    )
  })
})
