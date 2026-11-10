import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  SECTORS,
  humidityPercent,
  radarCoverage,
  recolorEchoes,
} from './radar.ts'

function pixels(
  size: number,
  filled: (x: number, y: number) => boolean,
): Uint8ClampedArray {
  let data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!filled(x, y)) continue
      let index = (y * size + x) * 4
      data[index] = 80
      data[index + 1] = 180
      data[index + 2] = 120
      data[index + 3] = 255
    }
  }
  return data
}

describe('radar coverage', () => {
  it('measures echo inside the disc and in each compass sector', () => {
    let size = 41
    let center = 20
    // A wedge on the north-east side, between 45 and 90 degrees.
    let data = pixels(
      size,
      (x, y) => x - center > center - y && x > center && y < center,
    )

    let result = radarCoverage(data, size, size, center, center, 19)

    assert.equal(result.sectors.length, SECTORS)
    assert.ok(result.sectors[1] > 0.85)
    assert.equal(result.sectors[0], 0)
    assert.equal(result.sectors[4], 0)
    assert.ok(result.total > 0.1 && result.total < 0.16)
  })

  it('ignores echo outside the radius', () => {
    let size = 21
    let data = pixels(size, () => true)

    let result = radarCoverage(data, size, size, 10, 10, 9)

    assert.equal(result.total, 1)
    assert.deepEqual(result.sectors, [1, 1, 1, 1, 1, 1, 1, 1])
  })

  it('treats transparent pixels as clear', () => {
    let size = 21

    let result = radarCoverage(
      new Uint8ClampedArray(size * size * 4),
      size,
      size,
      10,
      10,
      9,
    )

    assert.equal(result.total, 0)
  })
})

describe('echo colors', () => {
  it('warms the ramp as the echo strengthens and clears transparency', () => {
    let pixels = new Uint8ClampedArray([
      16,
      196,
      22,
      255, // green, moderate
      0,
      0,
      0,
      0, // transparent
      170,
      176,
      180,
      255, // grey, light
      230,
      60,
      50,
      255, // red, heavy
    ])

    recolorEchoes(pixels)

    // Warmth is red minus blue: light stays cold, heavy turns hot.
    let warmth = (index: number) => pixels[index] - pixels[index + 2]

    assert.equal(pixels[7], 0, 'transparent stays transparent')
    assert.ok(warmth(8) < warmth(0), 'light echo is colder than moderate')
    assert.ok(warmth(0) < warmth(12), 'heavy echo is hotter than moderate')
    assert.ok(pixels[10] > pixels[8], 'light echo stays blue')
  })
})

describe('humidity', () => {
  it('reads relative humidity from the temperature and dewpoint', () => {
    assert.equal(
      humidityPercent({
        ref: 't',
        c: 23,
        dewpoint_c: 12,
        dewpoint_spread_c: 11,
      }),
      50,
    )
    assert.equal(
      humidityPercent({
        ref: 't',
        c: 10,
        dewpoint_c: 10,
        dewpoint_spread_c: 0,
      }),
      100,
    )
    assert.equal(humidityPercent(null), null)
  })
})
