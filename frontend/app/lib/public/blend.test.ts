import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { BundleMetar } from '#app/lib/api-types.ts'
import { blendStations } from './blend.ts'

function metar(overrides: Partial<BundleMetar> = {}): BundleMetar {
  return {
    ref: 'metar.KAAA',
    raw: 'METAR KAAA 010000Z 27010KT 10SM CLR 20/10 A3000',
    observed_at: '2026-11-01T00:00:00Z',
    age_seconds: 600,
    station: 'KAAA',
    is_automated: false,
    flight_category: {
      ref: 'metar.KAAA.flight_category',
      value: 'VFR',
      basis: '',
    },
    wind: {
      ref: 'metar.KAAA.wind',
      direction_deg: 270,
      speed_kt: 10,
      gust_kt: null,
      is_variable: false,
      is_calm: false,
    },
    visibility: {
      ref: 'metar.KAAA.visibility',
      statute_miles: 10,
      is_greater_than: false,
      is_less_than: false,
    },
    ceiling: { ref: 'metar.KAAA.ceiling', ft: 4000 },
    clouds: [],
    weather: [],
    temperature: {
      ref: 'metar.KAAA.temperature',
      c: 20,
      dewpoint_c: 10,
      dewpoint_spread_c: 10,
    },
    humidity: { ref: 'metar.KAAA.humidity', relative_pct: 52 },
    altimeter_in_hg: 30,
    remarks: null,
    ...overrides,
  }
}

describe('blend', () => {
  it('passes a single report through untouched', () => {
    let blend = blendStations([{ distance_nm: 0, metar: metar() }])

    assert.ok(blend !== null)
    assert.equal(blend.used, 1)
    assert.equal(blend.total, 1)
    assert.equal(blend.distance_nm, 0)
    assert.equal(blend.visibility_sm?.value, 10)
    assert.equal(blend.visibility_sm?.low, 10)
    assert.equal(blend.ceiling_ft?.value, 4000)
    assert.equal(blend.temperature_c, 20)
    assert.equal(blend.humidity_pct, 52)
    assert.equal(blend.wind?.direction_deg, 270)
    assert.equal(blend.wind?.speed_kt, 10)
  })

  it('lets the nearest station pull the blend', () => {
    let blend = blendStations([
      { distance_nm: 0, metar: metar() },
      {
        distance_nm: 9,
        metar: metar({
          visibility: {
            ref: 'metar.KBBB.visibility',
            statute_miles: 0,
            is_greater_than: false,
            is_less_than: false,
          },
        }),
      },
    ])

    assert.ok(blend !== null)
    // Weights are 1 and 1/10, so 10 SM at the click dominates 0 SM at 9 nm.
    assert.ok(Math.abs((blend.visibility_sm?.value ?? 0) - 9.1) < 0.01)
    assert.equal(blend.visibility_sm?.low, 0)
    assert.equal(blend.visibility_sm?.high, 10)
  })

  it('counts the reports it could not use', () => {
    let blend = blendStations([
      { distance_nm: 2, metar: metar() },
      { distance_nm: 4, metar: null },
    ])

    assert.ok(blend !== null)
    assert.equal(blend.used, 1)
    assert.equal(blend.total, 2)
  })

  it('has no wind when no report gives a direction', () => {
    let blend = blendStations([
      {
        distance_nm: 3,
        metar: metar({
          wind: {
            ref: 'metar.KAAA.wind',
            direction_deg: null,
            speed_kt: 8,
            gust_kt: null,
            is_variable: true,
            is_calm: false,
          },
        }),
      },
    ])

    assert.ok(blend !== null)
    assert.equal(blend.wind, null)
  })

  it('averages directions as vectors, not as numbers', () => {
    let blend = blendStations([
      { distance_nm: 0, metar: metar() },
      {
        distance_nm: 0,
        metar: metar({
          wind: {
            ref: 'metar.KBBB.wind',
            direction_deg: 90,
            speed_kt: 10,
            gust_kt: null,
            is_variable: false,
            is_calm: false,
          },
        }),
      },
    ])

    assert.ok(blend !== null)
    // 270 and 090 at the same weight cancel out, so there is no direction.
    assert.equal(blend.wind?.speed_kt, 0)
  })
})
