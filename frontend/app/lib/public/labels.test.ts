import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type { BundleMetar, BundlePeriod } from '#app/lib/api-types.ts'
import {
  ceilingLabel,
  periodWindLabel,
  temperatureLabel,
  visibilityLabel,
  windLabel,
} from './labels.ts'

function metar(overrides: Record<string, unknown>): BundleMetar {
  return {
    wind: null,
    visibility: null,
    ceiling: { ft: null },
    temperature: null,
    ...overrides,
  } as unknown as BundleMetar
}

function period(overrides: Record<string, unknown>): BundlePeriod {
  return {
    wind: null,
    ...overrides,
  } as unknown as BundlePeriod
}

describe('fact labels', () => {
  it('reads wind as calm, variable or a direction', () => {
    assert.equal(windLabel(metar({})), 'not reported')
    assert.equal(
      windLabel(metar({ wind: { is_calm: true, is_variable: false } })),
      'calm',
    )
    assert.equal(
      windLabel(
        metar({
          wind: {
            direction_deg: 270,
            speed_kt: 9,
            gust_kt: 18,
            is_calm: false,
            is_variable: false,
          },
        }),
      ),
      '270° at 9 kt gusting 18 kt',
    )
    assert.equal(
      windLabel(
        metar({
          wind: {
            direction_deg: null,
            speed_kt: 4,
            gust_kt: null,
            is_calm: false,
            is_variable: true,
          },
        }),
      ),
      'variable at 4 kt',
    )
  })

  it('keeps the floor and ceiling qualifiers on visibility', () => {
    assert.equal(
      visibilityLabel(metar({ visibility: { statute_miles: 10, is_greater_than: true } })),
      'more than 10 SM',
    )
    assert.equal(
      visibilityLabel(metar({ visibility: { statute_miles: 0.25, is_less_than: true } })),
      'less than 0.25 SM',
    )
  })

  it('says no ceiling when there is none', () => {
    assert.equal(ceilingLabel(metar({})), 'no ceiling')
    assert.equal(ceilingLabel(metar({ ceiling: { ft: 2400 } })), '2,400 ft')
  })

  it('includes the spread only when the dewpoint is known', () => {
    assert.equal(
      temperatureLabel(
        metar({ temperature: { c: 12.2, dewpoint_c: 10, dewpoint_spread_c: 2.2 } }),
      ),
      '12.2 °C / dewpoint 10 °C, spread 2.2 °C',
    )
    assert.equal(temperatureLabel(metar({})), 'not reported')
  })

  it('labels a forecast period wind, or a dash when absent', () => {
    assert.equal(periodWindLabel(period({})), '—')
    assert.equal(
      periodWindLabel(period({ wind: { direction_deg: 300, speed_kt: 5, gust_kt: null } })),
      '300° at 5 kt',
    )
  })
})
