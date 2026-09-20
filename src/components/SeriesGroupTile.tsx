import { useEffect, useLayoutEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import { deckDepth } from '../lib/deckDepth'
import { fitPanel } from '../lib/panelFit'
import type { Edges } from '../lib/panelFit'
import type { SeriesGroup } from '../lib/volumeGroups'
import VolumeGroupTile from './VolumeGroupTile'

/**
 * The edges of the nearest thing that would cut this element off - the scrolling column
 * the shelf lives in, or the window when nothing else clips.
 *
 * An absolutely positioned box is clipped by any ancestor that scrolls, however far above
 * it that ancestor is, so the search walks up rather than assuming the shelf's own layout.
 */
function clipBounds(el: HTMLElement): Edges {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node)
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      const { left, right } = node.getBoundingClientRect()
      return { left, right }
    }
  }
  return { left: 0, right: document.documentElement.clientWidth }
}

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

  // Measured before the browser paints, so a panel that has to move is never seen in the
  // place it could not fit.
  //
  // Against the box that CLIPS the panel, not against the window. The shelf scrolls inside
  // its own column, and an absolutely positioned panel is cut off at that column's edges -
  // so a panel measured against the window fits the screen and is still half invisible,
  // with the sidebar showing through where the rest of it should be.
  //
  // Re-measured on resize because the one way to change the column's width mid-panel is to
  // turn the phone, which is exactly the case this gets wrong.
  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const el = panel.current, tile = root.current
      if (!el || !tile) return
      const bounds = clipBounds(el)
      // Capped first, then measured: the cap is what makes a wide panel wrap, and it is
      // the wrapped width that decides where the panel has to sit.
      el.style.setProperty('--panel-max', `${fitPanel(tile.getBoundingClientRect(), 0, bounds).maxWidth}px`)
      const { shift } = fitPanel(
        tile.getBoundingClientRect(),
        el.getBoundingClientRect().width,
        bounds,
      )
      el.style.setProperty('--panel-shift', `${shift}px`)
      // A panel hangs below its tile, and a phone held sideways leaves a column barely
      // taller than one - so the panel opens correctly placed and entirely below the fold,
      // which to the reader is a tile that does nothing when tapped. `nearest` scrolls the
      // least it can and does nothing at all when the panel is already in view, so a
      // desktop shelf never moves under the pointer.
      // Optional: placing the panel is the job, and being shown it is the courtesy. An
      // environment without scrollIntoView still gets a correctly placed panel rather than
      // an exception out of a layout effect, which would cost the whole shelf.
      el.scrollIntoView?.({ block: 'nearest' })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
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
        <div className="series-tile__panel" ref={panel}>
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
