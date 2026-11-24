import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  clampSheetHeight,
  resolveSheetDrop,
  SHEET_DISMISS_PX,
} from './sheet-drag.ts'

describe('mobile sheet drag physics', () => {
  const VIEWPORT = 667 // iPhone SE viewport height

  it('clamps dragged sheet height between 0 and the full viewport height', () => {
    assert.equal(clampSheetHeight(-40, VIEWPORT), 0)
    assert.equal(clampSheetHeight(320.4, VIEWPORT), 320)
    assert.equal(clampSheetHeight(VIEWPORT + 120, VIEWPORT), VIEWPORT)
  })

  it('snaps to full height when dragged up near the top', () => {
    assert.equal(resolveSheetDrop(VIEWPORT * 0.85, VIEWPORT, 0), 'full')
    assert.equal(resolveSheetDrop(VIEWPORT, VIEWPORT, 0), 'full')
  })

  it('stays at half height in the middle band on slow release', () => {
    assert.equal(resolveSheetDrop(VIEWPORT * 0.56, VIEWPORT, 0), 'half')
  })

  it('snaps to peek when dragged down into the low band without dismissing', () => {
    assert.equal(resolveSheetDrop(180, VIEWPORT, 0), 'peek')
  })

  it('dismisses when dragged down past the dismiss threshold', () => {
    assert.equal(resolveSheetDrop(SHEET_DISMISS_PX, VIEWPORT, 0), 'dismiss')
    assert.equal(resolveSheetDrop(64, VIEWPORT, 0), 'dismiss')
  })

  it('steps up or down on fast vertical flicks', () => {
    assert.equal(resolveSheetDrop(VIEWPORT * 0.52, VIEWPORT, -0.8), 'full')
    assert.equal(resolveSheetDrop(VIEWPORT * 0.28, VIEWPORT, -0.8), 'half')
    assert.equal(resolveSheetDrop(VIEWPORT * 0.84, VIEWPORT, 0.8), 'half')
    assert.equal(resolveSheetDrop(VIEWPORT * 0.55, VIEWPORT, 0.8), 'peek')
    assert.equal(resolveSheetDrop(VIEWPORT * 0.35, VIEWPORT, 0.8), 'dismiss')
  })
})
