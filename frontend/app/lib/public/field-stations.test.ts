import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import type {
  AreaPayload,
  AreaStation,
  BundleMetar,
  BundleStation,
} from '#app/lib/api-types.ts'
import { areaFieldStations, screenOffset } from './field-stations.ts'

function area(icao: string, lat: number, lon: number): AreaStation {
  return { icao, name: icao, state: null, lat, lon, distance_nm: 1 }
}

function report(
  icao: string,
  temperature: number,
  direction: number,
  speed: number,
): BundleStation {
  return {
    icao,
    name: icao,
    lat: 0,
    lon: 0,
    taf: null,
    advisories: [],
    metar: {
      temperature: {
        ref: '',
        c: temperature,
        dewpoint_c: null,
        dewpoint_spread_c: null,
      },
      wind: {
        ref: '',
        direction_deg: direction,
        speed_kt: speed,
        gust_kt: null,
        is_variable: false,
        is_calm: false,
      },
    } as BundleMetar,
  }
}

function payload(
  stations: AreaStation[],
  reports: BundleStation[],
): AreaPayload {
  return {
    lat: 34,
    lon: -118,
    radius_nm: 15,
    stations,
    brief: {
      generated_at: '',
      definition_version: '',
      stations: reports,
      definitions: {},
      brief_hash: '',
    },
  }
}

describe('areaFieldStations', () => {
  it('gives each station its own temperature and wind', () => {
    let fields = areaFieldStations(
      payload(
        [area('KAAA', 34, -118), area('KBBB', 34.1, -118.1)],
        [report('KAAA', 12, 270, 9), report('KBBB', 20, 90, 4)],
      ),
    )

    assert.equal(fields[0].temperature, 12)
    assert.equal(fields[0].wind?.direction_deg, 270)
    assert.equal(fields[1].temperature, 20)
    assert.equal(fields[1].wind?.direction_deg, 90)
  })

  it('leaves a station with no report empty', () => {
    let fields = areaFieldStations(payload([area('KCCC', 34, -118)], []))

    assert.equal(fields[0].temperature, null)
    assert.equal(fields[0].wind, null)
  })
})

describe('screenOffset', () => {
  it('puts north up and east to the right, in screen pixels', () => {
    let north = screenOffset(34, -118, 34.25, -118, 10)
    let east = screenOffset(34, -118, 34, -117.75, 10)

    assert.equal(north.x, 0)
    assert.equal(north.y, -150)
    assert.equal(Math.round(east.x), 124)
  })
})
