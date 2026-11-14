import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  RAIN_FALL,
  SECTORS,
  radarCoverage,
  ECHO_LEVELS,
  echoLevel,
  radarDrops,
  echoSteps,
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

describe('echo steps', () => {
  it('reports the ramp step each pixel took, and none for clear pixels', () => {
    let pixels = new Uint8ClampedArray([
      170,
      176,
      180,
      255, // lightest
      0,
      0,
      0,
      0, // clear
      16,
      196,
      22,
      255, // moderate
      230,
      60,
      50,
      255, // heaviest
    ])

    let steps = echoSteps(pixels)

    assert.equal(steps[0], 1)
    assert.equal(steps[1], 0)
    assert.equal(steps[2], 7)
    assert.equal(steps[3], 11)
    assert.equal(pixels[0], 170, 'the window is read, not repainted')
  })
})

describe('radar drops', () => {
  it('places nothing where there is no echo', () => {
    let size = 30
    let steps = new Uint8Array(size * size)

    assert.deepEqual(radarDrops(steps, size, size / 2), [])
  })

  it('places drops only inside the echoed area, within the disc', () => {
    let size = 60
    let half = size / 2
    let steps = new Uint8Array(size * size)
    // Well inside the north-west quadrant, so no cell jitter can cross it.
    for (let y = 0; y < half - 12; y++) {
      for (let x = 0; x < half - 12; x++) steps[y * size + x] = 6
    }

    let drops = radarDrops(steps, size, half)

    assert.ok(drops.length > 0)
    for (let drop of drops) {
      assert.ok(drop.x < 0 && drop.y < 0, 'drops follow the echo, north-west')
      assert.ok(Math.hypot(drop.x, drop.y) <= 1, 'drops stay inside the disc')
      // The window is a solid step 6, which is level 1.
      assert.equal(drop.level, echoLevel(5))
    }
  })

  it('sets a separate level for each band of echo', () => {
    let size = 60
    let half = size / 2
    let light = new Uint8Array(size * size)
    let heavy = new Uint8Array(size * size)
    for (let y = 10; y < 50; y++) {
      for (let x = 10; x < 50; x++) {
        light[y * size + x] = 1
        heavy[y * size + x] = 11
      }
    }

    let lightDrops = radarDrops(light, size, half)
    let heavyDrops = radarDrops(heavy, size, half)

    assert.ok(lightDrops.every((drop) => drop.level === 0))
    assert.ok(heavyDrops.every((drop) => drop.level === ECHO_LEVELS - 1))
    // The light band is nearly bare; the heavy one is most of it.
    assert.ok(heavyDrops.length > lightDrops.length * 4)
  })

  it('gives the same drops for the same window', () => {
    let size = 40
    let steps = new Uint8Array(size * size).fill(4)

    assert.deepEqual(
      radarDrops(steps, size, size / 2),
      radarDrops(steps, size, size / 2),
    )
  })

  it('keeps a drop inside the echo it takes its level from', () => {
    let size = 60
    let half = size / 2
    let steps = new Uint8Array(size * size)
    // Two clusters side by side: light on the west, heavy on the east.
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) steps[y * size + x] = x < half ? 2 : 9
    }

    let drops = radarDrops(steps, size, half)
    assert.ok(drops.length > 0)

    for (let drop of drops) {
      let startX = drop.x * half + half
      let startY = drop.y * half + half
      let start = steps[Math.round(startY) * size + Math.round(startX)]
      assert.equal(
        drop.level,
        echoLevel(start - 1),
        'the drop sits in its echo',
      )

      let endX = Math.round(startX + RAIN_FALL.ux * drop.travel * half)
      let endY = Math.round(startY + RAIN_FALL.uy * drop.travel * half)
      assert.equal(
        steps[endY * size + endX],
        start,
        'and falls no further than that echo',
      )
      assert.ok(drop.travel > 0, 'a drop that could not fall was dropped')
    }
  })
})
