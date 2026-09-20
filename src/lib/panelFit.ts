/** How close a floating panel may come to the edge of the space it is allowed to use. */
const GUTTER = 16

/** The left and right edges of something, in viewport coordinates. */
export interface Edges {
  left: number
  right: number
}

export interface PanelFit {
  /** The widest the panel may be drawn, so that all of it lands inside `bounds`. */
  maxWidth: number
  /** How far to move the panel from where it sits left-aligned with its tile, in px. */
  shift: number
}

/**
 * Where to put a panel hanging off a tile, so that every part of it is somewhere the
 * reader can see.
 *
 * `bounds` is the box the panel is CLIPPED to, which is not the window: the shelf scrolls
 * inside its own column, and an absolutely positioned panel is cut off at that column's
 * edges. Measuring the fit against the window instead is what put the panel behind the
 * sidebar - on a phone held sideways the column is 437px of a 667px screen, so a panel
 * flipped to fit the screen still had 153px of itself clipped away, and what showed
 * through the gap was the rail.
 *
 * Left-aligned with the tile is the resting position, because a panel that opens where
 * the tile is is the one that reads as belonging to it. From there:
 *  - it hangs off the tile's other edge if that is what makes it fit, which is the last
 *    column's case and the only one a wide window ever hits;
 *  - and if it STILL does not fit, it stops at the column's edge rather than carrying on
 *    into the rail. A panel one gutter from the edge is one you can read; a panel
 *    correctly aligned to a tile and half invisible is not.
 */
export function fitPanel(
  tile: Edges,
  panelWidth: number,
  bounds: Edges,
  gutter: number = GUTTER,
): PanelFit {
  // A column too narrow to hold a gutter either side is not a layout this can rescue, but
  // it must not hand back a negative width - that collapses the panel to nothing, which is
  // worse than a panel running into the edge.
  const maxWidth = Math.max(bounds.right - bounds.left - gutter * 2, gutter)
  const width = Math.min(panelWidth, maxWidth)

  // Right-aligned only if left-aligned would overrun, so the resting position wins
  // wherever it works.
  const preferred = tile.left + width > bounds.right - gutter ? tile.right - width : tile.left
  const placed = Math.max(preferred, bounds.left + gutter)

  return { maxWidth, shift: placed - tile.left }
}
