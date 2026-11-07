import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { toDarkMonochrome, toMonochrome } from './monochrome.ts'

describe('monochrome basemap', () => {
  it('converts hex colors to their grey value', () => {
    assert.equal(toMonochrome('#ff0000'), '#4c4c4c')
    assert.equal(toMonochrome('#00ff00'), '#969696')
    assert.equal(toMonochrome('#0000ff'), '#1d1d1d')
  })

  it('expands the short form and keeps alpha', () => {
    assert.equal(toMonochrome('#fff'), '#ffffff')
    assert.equal(toMonochrome('rgba(255, 0, 0, 0.5)'), 'rgba(76, 76, 76, 0.5)')
  })

  it('walks nested style objects and leaves other strings alone', () => {
    let style = {
      layers: [{ paint: { 'fill-color': '#ff0000' } }],
      name: 'positron',
    }

    assert.deepEqual(toMonochrome(style), {
      layers: [{ paint: { 'fill-color': '#4c4c4c' } }],
      name: 'positron',
    })
  })

  it('inverts the greys for the dark basemap', () => {
    assert.equal(toDarkMonochrome('#ffffff'), '#000000')
    assert.equal(toDarkMonochrome('#000000'), '#ffffff')
    assert.equal(toDarkMonochrome('#ff0000'), '#b3b3b3')
  })
})
