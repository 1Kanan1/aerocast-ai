import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { router } from '../router.ts'
import { routes } from '../routes.ts'
import {
  envelope,
  get,
  mockApi,
  mockApiDown,
  ORIGIN,
  STATION,
} from './test-helpers.ts'

const RAW = 'METAR KSFO 052156Z 03003KT 10SM SCT200 18/13 A3008'

const METAR_ROW = {
  station_icao: 'KSFO',
  obs_time: '2026-11-05T21:56:00Z',
  report_time: null,
  raw: RAW,
  decoded: {},
  category: 'VFR',
  upstream_category: 'VFR',
  parse_status: 'ok',
  parser_version: 'metar-1.1.0',
  fetched_at: '2026-11-05T22:00:00Z',
}

const BUNDLE = {
  generated_at: '2026-11-05T22:00:00Z',
  definition_version: 'defs-1.0.0',
  stations: [
    {
      icao: 'KSFO',
      name: STATION.name,
      lat: STATION.lat,
      lon: STATION.lon,
      metar: {
        ref: 'metar.KSFO',
        raw: RAW,
        observed_at: METAR_ROW.obs_time,
        age_seconds: 240,
        station: 'KSFO',
        is_automated: false,
        flight_category: {
          ref: 'metar.KSFO.flight_category',
          value: 'VFR',
          basis: 'no ceiling, visibility 10 SM',
        },
        wind: {
          ref: 'metar.KSFO.wind',
          direction_deg: 30,
          speed_kt: 3,
          gust_kt: null,
          is_variable: false,
          is_calm: false,
        },
        visibility: {
          ref: 'metar.KSFO.visibility',
          statute_miles: 10,
          is_greater_than: false,
          is_less_than: false,
        },
        ceiling: { ref: 'metar.KSFO.ceiling', ft: null },
        clouds: [{ cover: 'SCT', base_ft: 20000, cloud_type: null }],
        weather: [],
        temperature: {
          ref: 'metar.KSFO.temperature',
          c: 17.8,
          dewpoint_c: 12.8,
          dewpoint_spread_c: 5,
        },
        altimeter_in_hg: 30.08,
        remarks: null,
      },
      taf: {
        ref: 'taf.KSFO',
        issued_at: '2026-11-05T20:58:00Z',
        valid_from: '2026-11-05T21:00:00Z',
        valid_to: '2026-11-06T00:00:00Z',
        is_amended: false,
        is_corrected: false,
        periods: [
          {
            ref: 'taf.KSFO.period.0',
            change: 'INITIAL',
            from: '2026-11-05T21:00:00Z',
            to: '2026-11-06T00:00:00Z',
            is_temporary: false,
            probability: null,
            wind: { direction_deg: 300, speed_kt: 5, gust_kt: null },
            visibility_sm: 6,
            ceiling_ft: null,
            weather: [],
            clouds: [],
          },
        ],
      },
      advisories: [],
    },
  ],
  definitions: { VFR: 'Ceiling above 3,000 ft and visibility above 5 SM.' },
  brief_hash: 'sha256:abc',
}

function stationHandlers(): Record<string, () => Response> {
  return {
    '/api/stations/KSFO': () =>
      Response.json(
        envelope({ station: STATION, metar: METAR_ROW, taf: null, advisories: [] }),
      ),
    '/api/stations/KSFO/brief': () => Response.json(envelope(BUNDLE)),
    '/api/stations/KSFO/observations': () =>
      Response.json(
        envelope([
          {
            obs_time: METAR_ROW.obs_time,
            report_time: null,
            category: 'VFR',
            raw: RAW,
            decoded: { clouds: [{ cover: 'SCT', base_ft: 20000 }] },
            parse_status: 'ok',
            fetched_at: METAR_ROW.fetched_at,
          },
        ]),
      ),
  }
}

async function ask(accept: string | null): Promise<Response> {
  let form = new FormData()
  form.set('question', 'Why is the ceiling low?')

  return router.fetch(
    new Request(new URL(routes.ask.href({ icao: 'KSFO' }), ORIGIN), {
      method: 'POST',
      body: form,
      headers: accept === null ? {} : { accept },
    }),
  )
}

describe('station page', () => {
  it('renders facts, forecast and history', async (t) => {
    mockApi(t, stationHandlers())

    let response = await get(routes.station.href({ icao: 'KSFO' }))
    let html = await response.text()

    assert.equal(response.status, 200)
    assert.match(html, /no ceiling, visibility 10 SM/)
    assert.match(html, /INITIAL/)
    assert.match(html, /Last 48 hours/)
    assert.match(html, new RegExp(RAW))
  })

  it('answers 404 for a station the API does not know', async (t) => {
    mockApi(t, {})

    let response = await get(routes.station.href({ icao: 'KZZZ' }))

    assert.equal(response.status, 404)
    assert.match(await response.text(), /not in the station list/)
  })

  it('answers 503 when the API is unreachable', async (t) => {
    mockApiDown(t)

    let response = await get(routes.station.href({ icao: 'KSFO' }))

    assert.equal(response.status, 503)
  })

  it('answers a question with JSON when the browser asks for it', async (t) => {
    mockApi(t, {})

    let response = await ask('application/json')

    assert.equal(response.status, 503)
    assert.match(JSON.stringify(await response.json()), /not available/)
  })

  it('renders the answer page when JavaScript is off', async (t) => {
    mockApi(t, {})

    let response = await ask(null)
    let html = await response.text()

    assert.equal(response.status, 503)
    assert.match(html, /Answer for KSFO/)
    assert.match(html, /not available right now/)
  })
})
