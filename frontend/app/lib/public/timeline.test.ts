import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { BundleMetar, BundleTaf } from '#app/lib/api-types.ts'
import {
  HOUR_MS,
  conditionsAt,
  forecastRange,
  readingAt,
  reportHours,
  type HistoryPoint,
  type TimelineStation,
} from './timeline.ts'

const BASE = Date.parse('2026-11-19T18:00:00Z')

function point(
  offset: number,
  overrides: Record<string, unknown> = {},
): HistoryPoint {
  return {
    obs_time: new Date(BASE + offset).toISOString(),
    category: 'VFR',
    raw: 'KSEA 191753Z 20005KT 10SM FEW060 05/04 A2990',
    decoded: {
      temperature_c: 5,
      wind: {
        direction_deg: 20,
        speed_kt: 5,
        gust_kt: null,
        is_variable: false,
      },
    },
    ...overrides,
  } as unknown as HistoryPoint
}

function station(overrides: Partial<TimelineStation> = {}): TimelineStation {
  return {
    facts: null,
    history: [],
    taf: null,
    ...overrides,
  } as TimelineStation
}

const TAF = {
  valid_from: new Date(BASE + 1 * HOUR_MS).toISOString(),
  valid_to: new Date(BASE + 12 * HOUR_MS).toISOString(),
  periods: [
    {
      change: 'FM',
      from: new Date(BASE + 1 * HOUR_MS).toISOString(),
      to: new Date(BASE + 5 * HOUR_MS).toISOString(),
      wind: { direction_deg: 300, speed_kt: 8, gust_kt: null },
      visibility_sm: 10,
      ceiling_ft: null,
      clouds: [],
      weather: [],
      probability: null,
    },
    {
      change: 'FM',
      from: new Date(BASE + 5 * HOUR_MS).toISOString(),
      to: new Date(BASE + 12 * HOUR_MS).toISOString(),
      wind: { direction_deg: 280, speed_kt: 0, gust_kt: null },
      visibility_sm: 6,
      ceiling_ft: 3000,
      clouds: [],
      weather: [],
      probability: null,
    },
  ],
} as unknown as BundleTaf

describe('timeline hours', () => {
  it('reads a past hour from the report closest to it', () => {
    let history = [point(-3 * HOUR_MS), point(-1 * HOUR_MS)]
    let conditions = conditionsAt(station({ history }), -1, BASE)

    assert.equal(conditions.kind, 'report')
    assert.equal(
      conditions.kind === 'report' ? conditions.point.obs_time : null,
      history[1].obs_time,
    )
  })

  it('says an hour has no report when the nearest one is too far', () => {
    let history = [point(-6 * HOUR_MS)]
    assert.equal(conditionsAt(station({ history }), -1, BASE).kind, 'no-report')
  })

  it('reads an hour ahead from the covering forecast period', () => {
    let conditions = conditionsAt(station({ taf: TAF }), 6, BASE)

    assert.equal(conditions.kind, 'period')
    assert.equal(
      conditions.kind === 'period' ? conditions.period.change : null,
      'FM',
    )
    assert.equal(
      conditions.kind === 'period' ? conditions.period.ceiling_ft : null,
      3000,
    )
  })

  it('says an hour ahead has no forecast when the TAF stops short', () => {
    assert.equal(
      conditionsAt(station({ taf: TAF }), 20, BASE).kind,
      'no-forecast',
    )
    assert.equal(conditionsAt(station({}), 6, BASE).kind, 'no-forecast')
  })

  it('gives a past hour its wind and temperature, a future one the TAF wind', () => {
    let past = readingAt(station({ history: [point(-1 * HOUR_MS)] }), -1, BASE)
    assert.equal(past?.temperature_c, 5)
    assert.equal(past?.wind?.direction_deg, 20)
    assert.equal(past?.wind?.speed_kt, 5)
    assert.equal(past?.wind?.is_calm, false)

    let ahead = readingAt(station({ taf: TAF }), 2, BASE)
    assert.deepEqual(ahead, {
      temperature_c: null,
      wind: { direction_deg: 300, speed_kt: 8, is_calm: false },
    })

    let calm = readingAt(station({ taf: TAF }), 6, BASE)
    assert.equal(calm?.wind?.is_calm, true)

    assert.equal(readingAt(station({ taf: TAF }), 20, BASE), null)
  })

  it('keeps the live report at now', () => {
    let facts = {
      temperature: { c: 7 },
      wind: { direction_deg: 180, speed_kt: 3, is_calm: false },
    } as unknown as BundleMetar

    assert.deepEqual(readingAt(station({ facts }), 0, BASE), {
      temperature_c: 7,
      wind: facts.wind,
    })
    assert.equal(readingAt(station({}), 0, BASE), null)
  })

  it('places report dots on the rail, inside its ends only', () => {
    let history = [
      point(-2 * HOUR_MS),
      point(-49 * HOUR_MS),
      point(-1 * HOUR_MS),
      point(2 * HOUR_MS),
    ]

    assert.deepEqual(reportHours(history, BASE), [-2, -1])
  })

  it('clips the forecast band to the future half and the rail', () => {
    assert.deepEqual(forecastRange(TAF, BASE), { from: 1, to: 12 })
    assert.equal(
      forecastRange(
        {
          ...TAF,
          valid_from: new Date(BASE - 4 * HOUR_MS).toISOString(),
          valid_to: new Date(BASE + 52 * HOUR_MS).toISOString(),
        },
        BASE,
      )?.to,
      48,
    )
    assert.equal(
      forecastRange(
        {
          ...TAF,
          valid_from: new Date(BASE - 4 * HOUR_MS).toISOString(),
          valid_to: new Date(BASE).toISOString(),
        },
        BASE,
      ),
      null,
    )
    assert.equal(forecastRange(null, BASE), null)
  })
})
