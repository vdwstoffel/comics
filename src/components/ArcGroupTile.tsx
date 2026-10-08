import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { deckDepth } from '../lib/deckDepth'
import { useBackOrigin } from '../lib/backOrigin'
import TileProgress from './TileProgress'
import type { ArcGroup } from '../lib/volumeGroups'

interface ArcGroupTileProps {
  group: ArcGroup
  /** Whether to say how many unread issues are behind the cover, and across how many
   *  series. Off on the Following shelf for the same reason a run's count is: that page
   *  is about which stories you keep up with, not how far behind you are on them. */
  showCount?: boolean
}

/**
 * One story arc's worth of unread comics, as a single tile.
 *
 * An arc is the one grouping that crosses series: on a shelf grouped by series, Avengers
 * and Captain America are two tiles that never say they are the same story.
 *
 * It opens the arc rather than a comic, because the arc page is the only place that knows
 * the running order - including the parts you do not own, which is exactly what you need
 * when the next one is in a series you have never read. Cover and name lead there
 * together: one tile, one way in.
 *
 * The cover is the first unread comic rather than Comic Vine's artwork for the arc. The
 * shelf has to draw before Comic Vine answers, and without a key at all.
 */
export default function ArcGroupTile({ group, showCount = true }: ArcGroupTileProps) {
  const back = useBackOrigin()
  const next = group.books[0]

  // Drawn back to front, so the deepest card is furthest from the cover in the document
  // as well as on the screen and no z-index is needed to order them.
  const depth = deckDepth(group.books.length)
  const plates = Array.from({ length: depth }, (_, i) => depth - i)

  return (
    <div className="volume-tile">
      <Link className="arc-tile__link" to={`/arcs/${encodeURIComponent(group.name)}`} state={back}>
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
            {/* The comic at the front of the arc, so the bar is how far into that one you
                are - the same thing the volume and series decks say. */}
            <TileProgress readState={next.readState} percent={next.percent} />
          </span>
        </span>
        {/* Clamped to two lines for the shelf's sake; the full name lives in the title,
            because an arc's is long and the part that is cut is the part that names it. */}
        <span className="volume-tile__name" title={group.name}>{group.name}</span>
        {showCount && (
          <span className="volume-tile__count">
            {/* An arc that never leaves its own series is still an arc, but "1 series" is
                a line of text that tells the reader nothing. */}
            {group.books.length} unread{group.seriesCount > 1 ? ` · ${group.seriesCount} series` : ''}
          </span>
        )}
      </Link>
    </div>
  )
}
