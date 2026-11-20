import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  GRID_SIZE,
  type WeatherGrid,
  fetchWeatherGrid,
  sampleGrid,
} from './weather-grid.ts'

function grid(temperature: (x: number, y: number) => number): WeatherGrid {
  let cells = []
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      cells.push({
        u: 10,
        v: 0,
        speed: 10,
        temperature: temperature(x, y),
        humidity: 50,
      })
    }
  }
  return { size: 4, cells }
}

describe('weather grid', () => {
  it('samples the flow at the corners and between them', () => {
    let weather = grid(() => 10)

    assert.deepEqual(sampleGrid(weather, -1, -1), {
      u: 10,
      v: 0,
      speed: 10,
      temperature: 10,
    })
    let middle = sampleGrid(weather, 0, 0)
    assert.equal(middle?.u, 10)
    assert.equal(middle?.temperature, 10)
  })

  it('blends temperature between neighbouring cells', () => {
    let weather = grid((x) => x * 10)

    let west = sampleGrid(weather, -1, 0)
    let east = sampleGrid(weather, 1, 0)
    let middle = sampleGrid(weather, 0, 0)

    assert.equal(west?.temperature, 0)
    assert.equal(east?.temperature, 30)
    assert.equal(middle?.temperature, 15)
  })

  it('clamps points outside the grid', () => {
    let weather = grid(() => 7)

    assert.equal(sampleGrid(weather, 3, 3)?.temperature, 7)
  })
})

describe('weather grid for an hour', () => {
  function answer(payload: unknown) {
    let original = globalThis.fetch
    let asked: URL | null = null
    globalThis.fetch = (async (input: string | URL) => {
      asked = new URL(String(input))
      return new Response(JSON.stringify(payload), { status: 200 })
    }) as typeof fetch
    return {
      get url(): URL {
        if (asked === null) throw new Error('the model was never asked')
        return asked
      },
      restore: () => {
        globalThis.fetch = original
      },
    }
  }

  const HOUR = Date.parse('2026-11-19T15:00:00Z')

  it('asks the model for that hour rather than now', async () => {
    let stub = answer([])
    try {
      await fetchWeatherGrid(
        47.45,
        -122.31,
        30,
        new AbortController().signal,
        HOUR,
      )
    } finally {
      stub.restore()
    }

    assert.equal(stub.url.searchParams.get('start_hour'), '2026-11-19T15:00')
    assert.equal(stub.url.searchParams.get('end_hour'), '2026-11-19T15:00')
    assert.equal(
      stub.url.searchParams.get('hourly'),
      'wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m',
    )
    assert.equal(stub.url.searchParams.get('current'), null)
  })

  it('is null when the model leaves that hour empty', async () => {
    let empty = {
      hourly: {
        wind_speed_10m: [null],
        wind_direction_10m: [null],
        temperature_2m: [null],
        relative_humidity_2m: [null],
      },
    }
    let stub = answer(
      Array.from({ length: GRID_SIZE * GRID_SIZE }, () => empty),
    )
    try {
      assert.equal(
        await fetchWeatherGrid(
          47.45,
          -122.31,
          30,
          new AbortController().signal,
          HOUR,
        ),
        null,
      )
    } finally {
      stub.restore()
    }
  })
})
