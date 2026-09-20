import { test, expect } from 'vitest'
import { fitPanel } from '../src/lib/panelFit'

/** The shelf column on a desktop window: wide, with room either side of a tile. */
const WIDE = { left: 230, right: 1400 }
/** The same column on a phone held sideways, with the 230px rail taking a third of it. */
const NARROW = { left: 230, right: 667 }

test('a panel that fits where it is left-aligned is not moved', () => {
  const tile = { left: 300, right: 460 }
  expect(fitPanel(tile, 558, WIDE).shift).toBe(0)
})

// The case the flip was written for: a tile in the last column.
test('a panel that would run off the right hangs off the tile other edge instead', () => {
  const tile = { left: 1200, right: 1360 }
  // Right-aligned with the tile: 1360 - 558 = 802, which is 398 left of where it started.
  expect(fitPanel(tile, 558, WIDE).shift).toBe(-398)
})

// The bug. Flipping is measured against the window, so a panel can flip to a position
// that fits the screen and still be cut off by the column it actually lives in - and what
// shows through the gap is the sidebar.
test('a flipped panel is not allowed past the left edge of its column', () => {
  const tile = { left: 475, right: 635 }
  const { shift } = fitPanel(tile, 558, NARROW)

  // Right-aligned would put it at 635 - 558 = 77, which is 153px into the rail.
  expect(635 - 558).toBeLessThan(NARROW.left)
  // So it stops at the column's edge, one gutter in.
  expect(tile.left + shift).toBe(NARROW.left + 16)
})

test('a panel never starts left of its column, whichever tile opened it', () => {
  for (const tile of [{ left: 262, right: 422 }, { left: 475, right: 635 }]) {
    const { shift, maxWidth } = fitPanel(tile, 558, NARROW)
    const left = tile.left + shift
    expect(left).toBeGreaterThanOrEqual(NARROW.left)
    expect(left + Math.min(558, maxWidth)).toBeLessThanOrEqual(NARROW.right)
  }
})

// Width is capped to the column for the same reason: a panel wider than the space it is
// clipped to cannot be placed anywhere that shows all of it.
test('a panel is never wider than the column that clips it', () => {
  expect(fitPanel({ left: 262, right: 422 }, 900, NARROW).maxWidth).toBe(667 - 230 - 32)
  expect(fitPanel({ left: 300, right: 460 }, 900, WIDE).maxWidth).toBe(1400 - 230 - 32)
})

// A column narrower than the gutters themselves is not a layout anyone can help, but it
// must not produce a negative width that collapses the panel to nothing.
test('an impossibly narrow column still yields a usable width', () => {
  expect(fitPanel({ left: 0, right: 10 }, 558, { left: 0, right: 20 }).maxWidth).toBeGreaterThan(0)
})
