export interface ZoomState {
  scale: number
  /** Pixels the page is shifted by, applied before the scale in `translate(x,y) scale(s)`. */
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

export const MIN_SCALE = 1
export const MAX_SCALE = 4

/** A page as it opens: whole, centred, untouched. */
export const FIT: ZoomState = { scale: 1, x: 0, y: 0 }

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high)

/**
 * Keep the page over the viewport it is shown in.
 *
 * At 1x there is nothing to pan and any offset would read as the page sitting crooked, so
 * it is pinned to centre. Above that, the slack in each direction is however much of the
 * scaled page hangs outside the viewport — half of it each way.
 */
export function clampOffset(scale: number, offset: Point, viewport: Size): Point {
  if (scale <= MIN_SCALE) return { x: 0, y: 0 }
  const slackX = ((scale - 1) * viewport.width) / 2
  const slackY = ((scale - 1) * viewport.height) / 2
  return {
    x: clamp(offset.x, -slackX, slackX),
    y: clamp(offset.y, -slackY, slackY),
  }
}

/**
 * Scale by `factor` while holding one point of the page still — the cursor under a wheel,
 * the midpoint between two fingers in a pinch.
 *
 * Without this a zoom drifts towards the centre and you chase the panel you were reading
 * around the screen. The transform is `translate(x,y) scale(s)` about the viewport centre,
 * so a point's position is `content * scale + offset + centre`; solving that for the
 * offset which leaves the point where it was gives the expression below.
 */
export function zoomAbout(state: ZoomState, factor: number, point: Point, viewport: Size): ZoomState {
  const scale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE)
  // Clamping can make the effective factor differ from the one asked for.
  const applied = scale / state.scale

  const centre = { x: viewport.width / 2, y: viewport.height / 2 }
  const fromCentre = { x: point.x - centre.x, y: point.y - centre.y }

  const offset = {
    x: fromCentre.x - (fromCentre.x - state.x) * applied,
    y: fromCentre.y - (fromCentre.y - state.y) * applied,
  }

  const { x, y } = clampOffset(scale, offset, viewport)
  return { scale, x, y }
}
