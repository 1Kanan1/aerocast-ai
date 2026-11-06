import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { windowLabel, ageLabel, timeLabel } from './format.ts'

describe('format', () => {
  it('keeps the date when a window crosses midnight', () => {
    assert.equal(
      windowLabel('2026-11-05T22:00:00Z', '2026-11-06T04:00:00Z'),
      '2026-11-05 22:00 UTC → 2026-11-06 04:00 UTC',
    )
  })

  it('drops the repeated date inside one day', () => {
    assert.equal(
      windowLabel('2026-11-05T21:00:00Z', '2026-11-05T22:00:00Z'),
      '2026-11-05 21:00 UTC → 22:00 UTC',
    )
  })

  it('labels ages by the unit a reader can use', () => {
    assert.equal(ageLabel(null), 'age unknown')
    assert.equal(ageLabel(30), 'just now')
    assert.equal(ageLabel(600), '10 min old')
    assert.equal(ageLabel(7200), '2 h old')
  })

  it('leaves an unparseable timestamp alone', () => {
    assert.equal(timeLabel('not a time'), 'not a time')
    assert.equal(timeLabel(null), 'unknown')
  })
})
