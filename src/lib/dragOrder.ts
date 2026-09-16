/**
 * Which row a drag has landed on.
 *
 * Extracted from the component deliberately: simulating pointer drags in jsdom tests the
 * simulation rather than the behaviour. This is the behaviour, and it is testable with
 * numbers.
 *
 * `itemTops` are viewport-relative tops in the list's current order; `itemHeight` is one
 * row's height, used only when there is no second row to measure a pitch against. A
 * pointer exactly on a boundary belongs to the row below it, so a slow drag moves exactly
 * one place rather than flickering between two.
 */
export function dropIndex(pointerY: number, itemTops: number[], itemHeight: number): number {
  if (itemTops.length === 0) return 0

  // The PITCH between rows, not a row's height. A gap, a margin or a border between rows
  // makes the two differ - the stylesheet ships 56px rows 8px apart - and dividing by the
  // height then drifts by a whole row a few rows down the list. Derived from the tops
  // themselves so no stylesheet change can break this again; the passed height is only the
  // fallback for a list too short to have a pitch of its own.
  const measured = itemTops.length > 1 ? itemTops[1] - itemTops[0] : itemHeight
  // A pitch of zero or less means the measurement told us nothing: rows not laid out yet,
  // or every rect reading zero. 1px is the smallest thing that still divides, and what it
  // buys is an in-range integer - the alternative is NaN or Infinity, and NaN is committed
  // as a move to a null index rather than being ignored.
  const pitch = measured > 0 ? measured : itemHeight > 0 ? itemHeight : 1

  const raw = Math.floor((pointerY - itemTops[0]) / pitch)
  return Math.min(Math.max(raw, 0), itemTops.length - 1)
}
