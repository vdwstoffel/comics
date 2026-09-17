import { useEffect, useState } from 'react'
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

  // Reset every time the dialog is built, so the protection does not quietly erode as a
  // session goes on: closing a volume and opening it again hides its covers afresh.
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(new Set())

  const count = group.books.length
  // A volume with one unread issue has nothing to spoil - that issue is the one you are
  // about to read.
  const hiding = count > 1

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
          {group.books.map((book, index) => {
            // The first is the one you would read next, so its cover is not a surprise you
            // are being protected from - it is the one you came here for.
            const hidden = hiding && index > 0 && !revealed.has(book.id)
            // The title spoils as readily as the art beneath it, so a hidden issue is
            // named by its number alone. That name is also the image's alt text, which
            // would otherwise read the spoiler out loud.
            const name = book.number ? `#${book.number}` : 'Hidden issue'
            return (
              <div className="volume-issues__issue" key={book.id}>
                <CoverTile
                  to={`/book/${book.id}`}
                  img={`/api/books/${book.id}/thumbnail`}
                  title={hidden ? name : tileLabel(book)}
                  subtitle={hidden ? '' : (book.number ? `#${book.number}` : '')}
                  readState={book.readState}
                  percent={book.percent}
                  blurred={hidden}
                />
                {/* A sibling of the tile, never a child: the tile wraps its whole body in
                    a link, so a button inside it would be invalid markup and every reveal
                    would open the comic instead of uncovering it. */}
                {hidden && (
                  <button
                    type="button"
                    className="volume-issues__reveal"
                    aria-label={`Reveal the cover of ${name}`}
                    onClick={() => setRevealed((seen) => new Set(seen).add(book.id))}
                  >
                    Reveal
                  </button>
                )}
              </div>
            )
          })}
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
