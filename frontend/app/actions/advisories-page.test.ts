import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { routes } from '#app/routes.ts'
import { envelope, get, mockApi, META } from './test-helpers.ts'

const ADVISORY = {
  kind: 'gairmet',
  source_id: 'ZULU:3W',
  hazard: 'IFR',
  severity: 'MOD',
  base_ft: null,
  top_ft: 5000,
  due_to: 'CEILING AND VISIBILITY',
  valid_from: '2026-11-05T20:00:00Z',
  valid_to: '2026-11-05T23:00:00Z',
  geom: { type: 'Polygon', coordinates: [] },
}

describe('advisories page', () => {
  it('groups active advisories by hazard', async (t) => {
    mockApi(t, {
      '/api/advisories': () =>
        Response.json(envelope([ADVISORY], { ...META, source: 'gairmet' })),
    })

    let response = await get(routes.advisories.href())
    let html = await response.text()

    assert.equal(response.status, 200)
    assert.match(html, /ZULU:3W/)
    assert.match(html, /CEILING AND VISIBILITY/)
  })

  it('says so when the API is down', async (t) => {
    mockApi(t, {})

    let response = await get(routes.advisories.href())

    assert.equal(response.status, 200)
    assert.match(await response.text(), /cannot be listed/)
  })
})
