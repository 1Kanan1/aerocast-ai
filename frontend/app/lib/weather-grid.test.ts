import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { type WeatherGrid, sampleGrid } from './weather-grid.ts'

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
