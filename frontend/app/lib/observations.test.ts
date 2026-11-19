import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { decodedReport } from './observations.ts'

const VFR = {
  altimeter_in_hg: 29.9,
  clouds: [
    { cover: 'FEW', base_ft: 6000 },
    { cover: 'SCT', base_ft: 10000 },
  ],
  dewpoint_c: 3.9,
  temperature_c: 5,
  visibility: {
    is_greater_than: false,
    is_less_than: false,
    statute_miles: 10,
  },
  weather: [],
  wind: {
    direction_deg: 20,
    gust_kt: null,
    is_variable: false,
    speed_kt: 5,
  },
}

const IFR = {
  altimeter_in_hg: null,
  clouds: [
    { cover: 'FEW', base_ft: 400 },
    { cover: 'BKN', base_ft: 800 },
  ],
  dewpoint_c: 1,
  temperature_c: 2,
  visibility: {
    is_greater_than: false,
    is_less_than: true,
    statute_miles: 2.5,
  },
  weather: ['RA'],
  wind: {
    direction_deg: null,
    gust_kt: 20,
    is_variable: true,
    speed_kt: 12,
  },
}

describe('decoded report', () => {
  it('maps a stored VFR report onto the label fields', () => {
    let report = decodedReport(VFR)

    assert.deepEqual(report.wind, {
      direction_deg: 20,
      gust_kt: null,
      is_calm: false,
      is_variable: false,
      speed_kt: 5,
    })
    assert.deepEqual(report.visibility, {
      is_greater_than: false,
      is_less_than: false,
      statute_miles: 10,
    })
    assert.equal(report.ceiling.ft, null)
    assert.deepEqual(report.clouds, [
      { base_ft: 6000, cover: 'FEW' },
      { base_ft: 10000, cover: 'SCT' },
    ])
    assert.deepEqual(report.temperature, {
      c: 5,
      dewpoint_c: 3.9,
      dewpoint_spread_c: 1.1,
    })
    assert.equal(report.altimeter_in_hg, 29.9)
    assert.deepEqual(report.weather, [])
  })

  it('derives the ceiling, the calm flag and an unknown dewpoint', () => {
    let report = decodedReport(IFR)

    assert.equal(report.ceiling.ft, 800)
    assert.equal(report.wind?.is_calm, false)
    assert.equal(report.wind?.is_variable, true)
    assert.equal(report.visibility?.is_less_than, true)
    assert.deepEqual(report.temperature, {
      c: 2,
      dewpoint_c: 1,
      dewpoint_spread_c: 1,
    })
    assert.equal(report.altimeter_in_hg, null)
    assert.deepEqual(report.weather, ['RA'])

    let calm = decodedReport({ ...IFR, wind: { speed_kt: 0 } })
    assert.equal(calm.wind?.is_calm, true)

    let dry = decodedReport({ ...IFR, dewpoint_c: null })
    assert.equal(dry.temperature?.dewpoint_spread_c, null)
  })

  it('keeps a report with no wind or clouds instead of inventing them', () => {
    let report = decodedReport({})

    assert.equal(report.wind, null)
    assert.equal(report.visibility, null)
    assert.equal(report.temperature, null)
    assert.equal(report.altimeter_in_hg, null)
    assert.deepEqual(report.clouds, [])
    assert.deepEqual(report.weather, [])
  })
})
