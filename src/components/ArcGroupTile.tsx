import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { deckDepth } from '../lib/deckDepth'
import type { ArcGroup } from '../lib/volumeGroups'

interface ArcGroupTileProps {
  group: ArcGroup
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
export default function ArcGroupTile({ group }: ArcGroupTileProps) {
  const next = group.books[0]

  // Drawn back to front, so the deepest card is furthest from the cover in the document
  // as well as on the screen and no z-index is needed to order them.
  const depth = deckDepth(group.books.length)
  const plates = Array.from({ length: depth }, (_, i) => depth - i)

  return (
    <div className="volume-tile">
      <Link className="arc-tile__link" to={`/arcs/${encodeURIComponent(group.name)}`}>
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
          {/* An arc that never leaves its own series is still an arc, but "1 series" is a
              line of text that tells the reader nothing. */}
          {group.books.length} unread{group.seriesCount > 1 ? ` · ${group.seriesCount} series` : ''}
        </span>
      </Link>
    </div>
  )
}
