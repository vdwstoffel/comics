import { useState } from 'react'
import { Link } from 'react-router-dom'
import CoverTile from './CoverTile'
import { tileLabel } from '../lib/tileLabel'
import type { VolumeGroup } from '../lib/volumeGroups'

interface VolumeGroupTileProps {
  group: VolumeGroup
}

/**
 * One volume's worth of unread comics, as a single tile that opens in place.
 *
 * Twenty unread issues of one run used to be twenty tiles, which buried every other run
 * on the shelf. The cover expands rather than navigates because looking inside is the
 * common move; the name beside it stays a way through to the volume itself, carrying the
 * filter you are already looking at so the page you land on shows the same comics.
 *
 * A volume holding a single unread comic is still a tile. A second rendering rule for
 * that case would cost more than the one redundant expander it saves.
 */
export default function VolumeGroupTile({ group }: VolumeGroupTileProps) {
  const [open, setOpen] = useState(false)
  const panelId = `volume-${group.editionId}-issues`
  const count = group.books.length

  return (
    <>
      <div className="volume-tile">
        <button
          type="button"
          className="volume-tile__cover"
          // A stable name, with the open/closed state carried by aria-expanded rather than
          // by the wording - a label that renames itself reads as a new control each time.
          aria-label={`Issues of ${group.editionName}`}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((wasOpen) => !wasOpen)}
        >
          <img src={`/api/editions/${group.editionId}/thumbnail`} alt={group.editionName} />
          <span className={`volume-tile__chevron${open ? ' volume-tile__chevron--open' : ''}`} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3.5 5L7 8.5L10.5 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
        <Link className="volume-tile__name" to={`/edition/${group.editionId}?status=unread`}>
          {group.editionName}
        </Link>
        <div className="volume-tile__count">{count} unread</div>
      </div>

      {/* Its own full-width row rather than growth inside the tile's grid cell, which
          would leave a tall column of empty space beside it. The cost is that opening a
          tile pushes the rest of its row down. */}
      {open && (
        <div className="volume-tile__issues" id={panelId}>
          {group.books.map((book) => (
            <CoverTile
              key={book.id}
              to={`/book/${book.id}`}
              img={`/api/books/${book.id}/thumbnail`}
              title={tileLabel(book)}
              subtitle={book.number ? `#${book.number}` : ''}
              readState={book.readState}
              percent={book.percent}
            />
          ))}
        </div>
      )}
    </>
  )
}
