import { test, expect } from 'vitest'
import { FIT, MAX_SCALE, clampOffset, zoomAbout } from '../src/lib/zoom.js'

const VIEWPORT = { width: 1000, height: 800 }

test('a page starts fitted, centred and unzoomed', () => {
  expect(FIT).toEqual({ scale: 1, x: 0, y: 0 })
})

// The whole point of zooming about a point: whatever was under the cursor stays there.
test('the point you zoom about does not move', () => {
  const point = { x: 250, y: 200 }

  const zoomed = zoomAbout(FIT, 2, point, VIEWPORT)

  // Where the content under `point` ends up after the transform.
  const before = { x: (point.x - VIEWPORT.width / 2 - FIT.x) / FIT.scale, y: (point.y - VIEWPORT.height / 2 - FIT.y) / FIT.scale }
  const after = { x: before.x * zoomed.scale + zoomed.x + VIEWPORT.width / 2, y: before.y * zoomed.scale + zoomed.y + VIEWPORT.height / 2 }
  expect(after.x).toBeCloseTo(point.x, 5)
  expect(after.y).toBeCloseTo(point.y, 5)
})

test('zooming never goes below fit', () => {
  expect(zoomAbout(FIT, 0.5, { x: 500, y: 400 }, VIEWPORT).scale).toBe(1)
  expect(zoomAbout({ scale: 1.2, x: 40, y: 40 }, 0.1, { x: 0, y: 0 }, VIEWPORT).scale).toBe(1)
})

test('zooming stops at the maximum', () => {
  expect(zoomAbout({ scale: 3.5, x: 0, y: 0 }, 4, { x: 500, y: 400 }, VIEWPORT).scale).toBe(MAX_SCALE)
})

// A fitted page is centred by definition; any leftover offset would show as a nudge.
test('returning to fit recentres the page', () => {
  const zoomed = zoomAbout(FIT, 3, { x: 100, y: 100 }, VIEWPORT)
  const back = zoomAbout(zoomed, 1 / 3, { x: 100, y: 100 }, VIEWPORT)

  expect(back).toEqual(FIT)
})

test('a fitted page cannot be panned at all', () => {
  expect(clampOffset(1, { x: 300, y: 200 }, VIEWPORT)).toEqual({ x: 0, y: 0 })
})

// Panning must not strand the page: at 2x there is half a viewport of slack each way.
test('panning stops at the edge of the page', () => {
  expect(clampOffset(2, { x: 9999, y: 9999 }, VIEWPORT)).toEqual({ x: 500, y: 400 })
  expect(clampOffset(2, { x: -9999, y: -9999 }, VIEWPORT)).toEqual({ x: -500, y: -400 })
})

test('a pan inside the bounds is left alone', () => {
  expect(clampOffset(2, { x: 100, y: -50 }, VIEWPORT)).toEqual({ x: 100, y: -50 })
})

test('zooming out from a corner pulls the page back into view', () => {
  const cornered = { scale: 4, x: 1500, y: 1200 }

  const out = zoomAbout(cornered, 0.5, { x: 0, y: 0 }, VIEWPORT)

  expect(Math.abs(out.x)).toBeLessThanOrEqual((out.scale - 1) * VIEWPORT.width / 2)
  expect(Math.abs(out.y)).toBeLessThanOrEqual((out.scale - 1) * VIEWPORT.height / 2)
})
