import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { parseCoordinates } from './coordinates.ts'

describe('parseCoordinates', () => {
  it('reads a hemisphere after each number', () => {
    assert.deepEqual(parseCoordinates('33.90N 118.05W'), {
      lat: 33.9,
      lon: -118.05,
    })
  })

  it('ignores degree signs, case and spacing', () => {
    assert.deepEqual(parseCoordinates('33.90°N, 118.05°W'), {
      lat: 33.9,
      lon: -118.05,
    })
    assert.deepEqual(parseCoordinates('  47.45 n  122.31 w '), {
      lat: 47.45,
      lon: -122.31,
    })
  })

  it('puts south and east on the other side of zero', () => {
    assert.deepEqual(parseCoordinates('33.90S 118.05E'), {
      lat: -33.9,
      lon: 118.05,
    })
  })

  it('reads a comma separated signed pair', () => {
    assert.deepEqual(parseCoordinates('33.90, -118.05'), {
      lat: 33.9,
      lon: -118.05,
    })
    assert.deepEqual(parseCoordinates('-33.90,118.05'), {
      lat: -33.9,
      lon: 118.05,
    })
  })

  it('accepts a unicode minus sign', () => {
    assert.deepEqual(parseCoordinates('33.90, \u2212118.05'), {
      lat: 33.9,
      lon: -118.05,
    })
  })

  it('refuses numbers outside the globe', () => {
    assert.equal(parseCoordinates('91N 118W'), null)
    assert.equal(parseCoordinates('33.90, -181'), null)
  })

  it('refuses a bare pair without a comma or a hemisphere', () => {
    assert.equal(parseCoordinates('33.90 118.05'), null)
  })

  it('refuses minutes and seconds', () => {
    assert.equal(parseCoordinates('33 54.0N 118 03.0W'), null)
  })

  it('refuses an airport code or a question', () => {
    assert.equal(parseCoordinates('KSEA'), null)
    assert.equal(parseCoordinates('what is the wind at 33.9N 118.05W'), null)
  })
})
