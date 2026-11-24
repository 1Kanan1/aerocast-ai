import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import {
  cameraPadding,
  clampSheetHeight,
  computePeekHeight,
  resolveSheetDrop,
  SHEET_DISMISS_PX,
  SHEET_HALF_VH,
  SHEET_PEEK_PX,
} from './sheet-drag.ts'

describe('mobile sheet drag physics', () => {
  const VIEWPORT = 667 // iPhone SE viewport height

  it('clamps dragged sheet height between 0 and the full viewport height', () => {
    assert.equal(clampSheetHeight(-40, VIEWPORT), 0)
    assert.equal(clampSheetHeight(320.4, VIEWPORT), 320)
    assert.equal(clampSheetHeight(VIEWPORT + 120, VIEWPORT), VIEWPORT)
  })

  it('snaps to full height when dragged up near the top', () => {
    assert.equal(resolveSheetDrop(VIEWPORT * 0.8, VIEWPORT, 0, 'half'), 'full')
    assert.equal(resolveSheetDrop(VIEWPORT, VIEWPORT, 0, 'half'), 'full')
  })

  it('stays at half height in the middle band on slow release', () => {
    assert.equal(resolveSheetDrop(VIEWPORT * 0.56, VIEWPORT, 0, 'half'), 'half')
  })

  it('snaps to slightly open (peek) when dragged slightly down from half', () => {
    // Dragging ~90px down from half (374px -> 284px) settles at peek
    assert.equal(resolveSheetDrop(284, VIEWPORT, 0, 'half'), 'peek')
    assert.equal(resolveSheetDrop(SHEET_PEEK_PX, VIEWPORT, 0, 'half'), 'peek')
  })

  it('dismisses when dragged down past the dismiss threshold', () => {
    assert.equal(
      resolveSheetDrop(SHEET_DISMISS_PX, VIEWPORT, 0, 'peek'),
      'dismiss',
    )
    assert.equal(resolveSheetDrop(64, VIEWPORT, 0, 'half'), 'dismiss')
  })

  it('steps cleanly across all four stages on vertical flicks', () => {
    // Flicking down from half lands on peek rather than skipping to dismiss
    assert.equal(
      resolveSheetDrop(VIEWPORT * 0.4, VIEWPORT, 0.8, 'half'),
      'peek',
    )
    // Flicking down from peek dismisses
    assert.equal(
      resolveSheetDrop(SHEET_PEEK_PX - 12, VIEWPORT, 0.8, 'peek'),
      'dismiss',
    )
    // Flicking down from full lands on half
    assert.equal(
      resolveSheetDrop(VIEWPORT * 0.8, VIEWPORT, 0.8, 'full'),
      'half',
    )
    // Flicking up from peek lands on half; from half lands on full
    assert.equal(
      resolveSheetDrop(VIEWPORT * 0.3, VIEWPORT, -0.8, 'peek'),
      'half',
    )
    assert.equal(
      resolveSheetDrop(VIEWPORT * 0.52, VIEWPORT, -0.8, 'half'),
      'full',
    )
  })

  it('centers the map camera in the visible area on mobile and desktop', () => {
    assert.deepEqual(cameraPadding(375, VIEWPORT), {
      top: 128,
      right: 0,
      bottom: Math.round(VIEWPORT * (SHEET_HALF_VH / 100)),
      left: 0,
    })
    assert.deepEqual(cameraPadding(1280, 800), {
      top: 84,
      right: 520,
      bottom: 96,
      left: 0,
    })
  })

  it('computes peek height from header and AskBar metrics with fallback', () => {
    assert.equal(computePeekHeight(92.5, 64), 156.5)
    assert.equal(computePeekHeight(92, 65), 157)
    assert.equal(computePeekHeight(20, 20), SHEET_PEEK_PX)
  })
})
