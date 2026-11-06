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

describe('home page', () => {
  it('server-renders the station list from the API', async (t) => {
    mockApi(t, {
      '/api/stations': () =>
        Response.json(envelope([STATION], { ...META, source: 'awc stations' })),
      '/api/map/layers': () =>
        Response.json(envelope({ stations: [], advisories: [] })),
    })

    let response = await get(routes.home.href())
    let html = await response.text()

    assert.equal(response.status, 200)
    assert.match(html, /KSFO/)
    assert.match(html, /Not for flight planning/)
  })

  it('mounts the map island over the same data', async (t) => {
    mockApi(t, {
      '/api/stations': () => Response.json(envelope([STATION])),
      '/api/map/layers': () =>
        Response.json(envelope({ stations: [], advisories: [] })),
    })

    let html = await (await get(routes.home.href())).text()

    assert.match(html, /MapIsland/)
    assert.match(html, /Not for navigation/)
  })

  it('proxies layer requests same-origin', async (t) => {
    let layers = envelope({ stations: [], advisories: [] })
    mockApi(t, { '/api/map/layers': () => Response.json(layers) })

    let response = await get(`${routes.layers.href()}?bbox=-123,37,-122,38`)

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), layers)
  })

  it('answers 502 when the layer proxy cannot reach the API', async (t) => {
    mockApiDown(t)

    let response = await get(routes.layers.href())

    assert.equal(response.status, 502)
  })
})
