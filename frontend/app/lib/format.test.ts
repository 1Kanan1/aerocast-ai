import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  windowLabel,
  ageLabel,
  timeLabel,
  tookLabel,
  modelLabel,
} from './format.ts'

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

  it('reads a model call in the unit that fits it', () => {
    assert.equal(tookLabel(240), '0.2s')
    assert.equal(tookLabel(4321), '4.3s')
    assert.equal(tookLabel(19_400), '19s')
    assert.equal(tookLabel(59_700), '1m')
    assert.equal(tookLabel(351_000), '5m 51s')
  })

  it('drops the vendor prefix a gateway repeats in the model id', () => {
    assert.equal(
      modelLabel('deepseek/deepseek-v4.1-flash-free'),
      'deepseek-v4.1-flash-free',
    )
    assert.equal(modelLabel('gemini-3.5-flash-lite'), 'gemini-3.5-flash-lite')
    assert.equal(modelLabel(''), '')
  })
})
