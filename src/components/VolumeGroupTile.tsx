import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { deckDepth } from '../lib/deckDepth'
import { useBackOrigin } from '../lib/backOrigin'
import TileProgress from './TileProgress'
import type { VolumeGroup } from '../lib/volumeGroups'

interface VolumeGroupTileProps {
  group: VolumeGroup
  /** Whether to say how many unread issues are behind the cover. Off on the Following
   *  shelf, which is about which runs you keep up with rather than how far behind you
   *  are on them - the deck of cards behind the cover still shows that much. */
  showCount?: boolean
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
export default function VolumeGroupTile({ group, showCount = true }: VolumeGroupTileProps) {
  // Read off the page this tile is drawn on rather than passed in: the library and the
  // follows shelf draw the same tile and it has no idea which of them it is on.
  const back = useBackOrigin()
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
        {/* Straight into the comic. The shelf is where you choose what to read next, so
            choosing one should start reading it rather than stopping at a page about it.
            `back: 'run'` is what the reader closes into - this volume's run, standing on
            this comic - because the shelf you came from will no longer be showing it. */}
        <Link
          className="volume-tile__cover"
          to={`/read/${next.id}`}
          state={{ back: 'run' }}
          aria-label={next.number ? `${group.editionName} #${next.number}` : `${group.editionName}, next unread`}
        >
          {/* The comic this opens, not the volume it belongs to: a volume's own
              thumbnail is its lowest-numbered issue overall, which on a run you are
              partway through is one you read long ago. */}
          <img src={`/api/books/${next.id}/thumbnail`} alt="" />
          {/* Describes the comic this cover opens, which is the one you are in the
              middle of when there is one. */}
          <TileProgress readState={next.readState} percent={next.percent} />
        </Link>
      </div>
      {/* The name is clamped to two lines so the shelf's rows come out even, and the year
          that tells two runs of one series apart sits at the end of it - so the whole name
          is carried here, where a cut-off one can still be read. */}
      <Link
        className="volume-tile__name"
        title={group.editionName}
        to={`/edition/${group.editionId}?status=unread`}
        state={back}
      >
        {group.editionName}
      </Link>
      {showCount && <div className="volume-tile__count">{group.books.length} unread</div>}
    </div>
  )
}
