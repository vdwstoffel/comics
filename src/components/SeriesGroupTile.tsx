import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { deckDepth } from '../lib/deckDepth'
import type { SeriesGroup } from '../lib/volumeGroups'
import VolumeGroupTile from './VolumeGroupTile'

interface SeriesGroupTileProps {
  group: SeriesGroup
  open: boolean
  onToggle: () => void
  /** Clicked away, or Escape. Which series is open belongs to the shelf, because only
   *  one of them ever is. */
  onClose: () => void
}

/**
 * One series' worth of unread comics, as a single tile that opens onto its volumes.
 *
 * Three runs of Batman are three volumes, and drawing each of them on the shelf spends
 * three tiles saying "Batman" before any of them says which Batman. Collapsed, the series
 * is one tile; open, its volumes float over the shelf in a panel, which is the whole
 * point: unfolding them into the grid pushed every other comic down the page to make room
 * for a choice you make in a second and are then done with.
 *
 * The cover opens the panel rather than a comic. A volume tile can send you straight to
 * the front of its run because a run has a front; three parallel runs do not, and a cover
 * that opened one of them would open the wrong one two times in three. It still pictures a
 * comic you have not read - the front of the first run - because the series' own
 * thumbnail is an issue you finished long ago.
 *
 * A series holding one volume is drawn as that volume. The rule lives here rather than on
 * the shelf so there is one answer to "what does a series look like", and the panel would
 * buy the reader a second tile identical to the first.
 */
export default function SeriesGroupTile({ group, open, onToggle, onClose }: SeriesGroupTileProps) {
  const root = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  // A panel hanging off a tile in the last column would otherwise run off the side of the
  // window, so one that does not fit hangs off the tile's other edge instead.
  const [fromRight, setFromRight] = useState(false)

  // Only the open tile listens. A shelf of thirty series would otherwise keep thirty
  // handlers alive to answer a click none of them care about.
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) onClose()
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open, onClose])

  // Measured before the browser paints, so a panel that has to flip is never seen in the
  // place it could not fit.
  useLayoutEffect(() => {
    if (!open || !panel.current) { setFromRight(false); return }
    const { right } = panel.current.getBoundingClientRect()
    setFromRight(right > document.documentElement.clientWidth - 16)
  }, [open])

  if (group.volumes.length === 1) return <VolumeGroupTile group={group.volumes[0]} />

  const unread = group.volumes.reduce((sum, v) => sum + v.books.length, 0)
  const next = group.volumes[0].books[0]

  // Drawn back to front, so the deepest card is furthest from the cover in the document
  // as well as on the screen and no z-index is needed to order them.
  const depth = deckDepth(unread)
  const plates = Array.from({ length: depth }, (_, i) => depth - i)

  return (
    <div className="series-tile" ref={root}>
      <button
        type="button"
        className="series-tile__head"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="volume-tile__deck">
          {plates.map((step) => (
            <span
              key={step}
              className="volume-tile__plate"
              style={{ '--step': step } as CSSProperties}
              aria-hidden="true"
            />
          ))}
          <span className="volume-tile__cover">
            <img src={`/api/books/${next.id}/thumbnail`} alt="" />
          </span>
        </span>
        <span className="volume-tile__name">{group.name}</span>
        <span className="volume-tile__count">
          {group.volumes.length} volumes · {unread} unread
        </span>
      </button>
      {open && (
        <div
          className={`series-tile__panel${fromRight ? ' series-tile__panel--from-right' : ''}`}
          ref={panel}
        >
          <div className="series-tile__volumes">
            {group.volumes.map((volume) => (
              <VolumeGroupTile key={volume.editionId} group={volume} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
