import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  GRID_SIZE,
  type WeatherGrid,
  clearWeatherGridCache,
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

  it('turns meteorological wind direction into flow components', async () => {
    let cases: [number, number, number][] = [
      // North wind (0°) flows south (v < 0)
      [0, 0, -10],
      // East wind (90°) flows west (u < 0)
      [90, -10, 0],
      // South wind (180°) flows north (v > 0)
      [180, 0, 10],
      // West wind (270°) flows east (u > 0)
      [270, 10, 0],
    ]

    for (let [direction, expectedU, expectedV] of cases) {
      clearWeatherGridCache()
      let row = {
        current: {
          wind_speed_10m: 10,
          wind_direction_10m: direction,
          temperature_2m: 12,
          relative_humidity_2m: 50,
        },
      }
      let stub = answer(
        Array.from({ length: GRID_SIZE * GRID_SIZE }, () => row),
      )
      try {
        let loaded = await fetchWeatherGrid(
          47.45,
          -122.31,
          30,
          new AbortController().signal,
        )
        assert.ok(loaded !== null)
        assert.ok(Math.abs(loaded.cells[0].u - expectedU) < 1e-9)
        assert.ok(Math.abs(loaded.cells[0].v - expectedV) < 1e-9)
      } finally {
        stub.restore()
      }
    }
  })

  it('reuses a cached grid for the same station and hour until it expires', async () => {
    clearWeatherGridCache()
    let calls = 0
    let now = Date.parse('2026-11-19T15:00:00Z')
    let originalFetch = globalThis.fetch
    let originalNow = Date.now
    let row = {
      hourly: {
        wind_speed_10m: [10],
        wind_direction_10m: [270],
        temperature_2m: [12],
        relative_humidity_2m: [50],
      },
    }
    let payload = Array.from({ length: GRID_SIZE * GRID_SIZE }, () => row)

    globalThis.fetch = (async () => {
      calls += 1
      return new Response(JSON.stringify(payload), { status: 200 })
    }) as typeof fetch
    Date.now = () => now

    try {
      let signal = new AbortController().signal
      let first = await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR)
      let second = await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR)
      assert.ok(first !== null)
      assert.equal(second, first)
      assert.equal(calls, 1)

      // Different hour misses the cache.
      await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR + 60 * 60 * 1000)
      assert.equal(calls, 2)

      // After TTL, the original key refetches.
      now += 15 * 60 * 1000 + 1
      await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR)
      assert.equal(calls, 3)
    } finally {
      globalThis.fetch = originalFetch
      Date.now = originalNow
      clearWeatherGridCache()
    }
  })

  it('does not cache failed grid fetches', async () => {
    clearWeatherGridCache()
    let calls = 0
    let originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      calls += 1
      return new Response('rate limited', { status: 429 })
    }) as typeof fetch

    try {
      let signal = new AbortController().signal
      assert.equal(
        await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR),
        null,
      )
      assert.equal(
        await fetchWeatherGrid(47.45, -122.31, 30, signal, HOUR),
        null,
      )
      assert.equal(calls, 2)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
