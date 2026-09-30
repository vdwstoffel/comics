interface TileProgressProps {
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
}

/**
 * The bar along the bottom edge of a cover saying how far into that comic you are.
 *
 * Shared rather than written into each tile because it is the only thing that tells a
 * comic you are partway through from one you have never opened, and those two now sit side
 * by side: the unread shelf holds an issue until it is finished, so the tile has to carry
 * the distinction the shelf no longer makes.
 *
 * Nothing at all for a comic you have not started or have finished — a bar at 0% or 100%
 * would be a second, quieter way of saying what the empty cover and the check already say.
 * Its parent must be a positioned box; every cover here is one.
 */
export default function TileProgress({ readState, percent }: TileProgressProps) {
  if (readState !== 'reading') return null
  return (
    <div
      className="tile-progress"
      style={{ width: `${percent ?? 0}%` }}
      aria-label={`In progress: ${percent ?? 0}%`}
    />
  )
}
