import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { ceilingFt, visibilitySm } from './observations.ts'

describe('decoded observations', () => {
  it('takes the lowest broken, overcast or vertical layer', () => {
    let decoded = {
      clouds: [
        { cover: 'SCT', base_ft: 900 },
        { cover: 'BKN', base_ft: 2400 },
        { cover: 'OVC', base_ft: 1800 },
      ],
    }

    assert.equal(ceilingFt(decoded), 1800)
  })

  it('has no ceiling for few, scattered or clear layers', () => {
    assert.equal(ceilingFt({ clouds: [{ cover: 'FEW', base_ft: 300 }] }), null)
    assert.equal(ceilingFt({ clouds: [] }), null)
    assert.equal(ceilingFt(null), null)
  })

  it('reads visibility in statute miles, and reports its absence', () => {
    assert.equal(visibilitySm({ visibility: { statute_miles: 3 } }), 3)
    assert.equal(visibilitySm({}), null)
    assert.equal(visibilitySm(null), null)
  })
})
