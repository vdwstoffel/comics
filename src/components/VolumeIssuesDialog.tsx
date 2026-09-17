import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import CoverTile from './CoverTile'
import { tileLabel } from '../lib/tileLabel'
import type { VolumeGroup } from '../lib/volumeGroups'

interface VolumeIssuesDialogProps {
  group: VolumeGroup
  onClose: () => void
}

/**
 * What is left unread in one volume.
 *
 * A dialog rather than a panel opening inside the shelf: the shelf is a grid, and a
 * full-width panel cannot sit beside the tile it belongs to, so it starts a new row and
 * leaves the rest of that tile's row empty. Getting the panel to follow the tile's ROW
 * instead would mean measuring the column count at runtime. A dialog is correct at every
 * width without measuring anything, and a volume you are thirty issues behind on gets a
 * surface that scrolls rather than one taller than the page.
 */
export default function VolumeIssuesDialog({ group, onClose }: VolumeIssuesDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const count = group.books.length

  return (
    <div className="modal-backdrop" data-testid="volume-issues-backdrop" onClick={onClose}>
      {/* Clicks inside the panel must not reach the backdrop's close handler — reaching
          for a comic would otherwise dismiss the thing you are reaching into. */}
      <div
        className="modal-panel modal-panel--wide volume-issues"
        role="dialog"
        aria-modal="true"
        aria-label={group.editionName}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="volume-issues__head">
          <div>
            <h3>{group.editionName}</h3>
            <p className="modal-detail">{count} unread</p>
          </div>
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>

        <div className="volume-issues__grid">
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

        <div className="modal-actions">
          <Link className="btn-ghost" to={`/edition/${group.editionId}?status=unread`}>
            Open the volume
          </Link>
        </div>
      </div>
    </div>
  )
}
