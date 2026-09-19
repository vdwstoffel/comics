import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { deckDepth } from '../lib/deckDepth'
import type { VolumeGroup } from '../lib/volumeGroups'

interface VolumeGroupTileProps {
  group: VolumeGroup
}

/**
 * One volume's worth of unread comics, as a single tile.
 *
 * Twenty unread issues of one run used to be twenty tiles, which buried every other run
 * on the shelf. The cover opens the comic at the front of the run, because that is the
 * one you were going to read: a list of what is unread in a volume you are working
 * through in order only ever asked you to pick the first thing in it. The name beside it
 * stays a way through to the volume itself, carrying the filter you are already looking
 * at, so the whole run is still one click away when you do want to choose.
 *
 * A volume holding a single unread comic is still a tile. A second rendering rule for
 * that case would cost more than the one redundant step it saves.
 *
 * The cards behind the cover are how thick a backlog looks before you have read a word of
 * the tile. They are blank plates rather than the covers underneath: an unread cover is a
 * spoiler here, and a shelf of thirty volumes would otherwise ask for ninety more
 * thumbnails to draw an edge each.
 *
 * The link is named by the issue's number and never by its title. A title gives away as
 * much as a cover does, and this tile sits on a shelf of comics you have not read. An
 * unmatched comic has no number either, and the volume's name alone would collide with
 * the name link right beside it, so it says which of the two it is instead.
 */
export default function VolumeGroupTile({ group }: VolumeGroupTileProps) {
  // The server sorts by series then issue number and the grouping keeps that order, so
  // the first book is the lowest-numbered comic you have not read.
  const next = group.books[0]

  // Drawn back to front, so the deepest card is furthest from the cover in the document
  // as well as on the screen and no z-index is needed to order them.
  const depth = deckDepth(group.books.length)
  const plates = Array.from({ length: depth }, (_, i) => depth - i)

  return (
    <div className="volume-tile">
      <div className="volume-tile__deck">
        {plates.map((step) => (
          <span
            key={step}
            className="volume-tile__plate"
            style={{ '--step': step } as CSSProperties}
            aria-hidden="true"
          />
        ))}
        <Link
          className="volume-tile__cover"
          to={`/book/${next.id}`}
          aria-label={next.number ? `${group.editionName} #${next.number}` : `${group.editionName}, next unread`}
        >
          {/* The comic this opens, not the volume it belongs to: a volume's own
              thumbnail is its lowest-numbered issue overall, which on a run you are
              partway through is one you read long ago. */}
          <img src={`/api/books/${next.id}/thumbnail`} alt="" />
        </Link>
      </div>
      <Link className="volume-tile__name" to={`/edition/${group.editionId}?status=unread`}>
        {group.editionName}
      </Link>
      <div className="volume-tile__count">{group.books.length} unread</div>
    </div>
  )
}
