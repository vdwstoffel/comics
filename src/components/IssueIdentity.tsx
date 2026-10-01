import type { ReactNode } from 'react'

interface IssueIdentityProps {
  /** `#12`. The one thing every issue has, owned or not. */
  label: string
  /** Comic Vine's story title, which most issues do not have. */
  title?: string | null
  date?: string | null
  /** The year the comic came out, which the date may not state on its own. */
  year?: number | null
  publisher?: string | null
  pageCount?: number
  /** Whether what is known about the comic is written into the file itself. */
  comicinfoSynced?: boolean
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
  /** Correct what is known about the comic. Absent for a gap, which has none. */
  onEdit?: () => void
  /** Whatever the page offers for this issue - for a gap, the way to fill it. */
  action?: ReactNode
  /** Take the comic off the disk. Absent for a gap, which is an absence already. */
  onRemove?: () => void
}

/**
 * Which issue you are looking at, in one block: its name, when it came out, how long it
 * is and how far through it you are.
 *
 * Deliberately apart from IssueDetail, which carries the credits and the summary. On a
 * phone held upright the two are separated by the Missing and Coming soon sections, so
 * that what you can act on sits above the fold and the reference material below it. Side
 * by side in landscape they read as one block, which is why neither draws its own frame.
 */
export default function IssueIdentity({
  label, title, date, year, publisher, pageCount, comicinfoSynced,
  readState, percent, onEdit, action, onRemove,
}: IssueIdentityProps) {
  // The same subline the issue's own page carries, in the same order: when it came out,
  // who published it, how long it is, and whether the file holds all of that itself.
  // The year is left out when the date already opens with it, which it usually does.
  const sameYear = year != null && typeof date === 'string' && date.startsWith(String(year))
  const meta = [
    date ?? null,
    year != null && !sameYear ? String(year) : null,
    publisher ?? null,
    typeof pageCount === 'number' && pageCount > 0 ? `${pageCount} pages` : null,
    comicinfoSynced ? 'metadata embedded' : null,
  ].filter((part): part is string => part !== null)

  return (
    <div className="issue-identity">
      <h2 className="issue-identity__name">
        <span className="issue-identity__number">{label}</span>
        {title && <span className="issue-identity__title">{title}</span>}
        {/* Beside the name, as it was beside the name on the comic's own page. What is
            behind it - correcting the metadata, fetching it again, moving the comic to
            another edition - is the rarest thing anyone does here, so it is a pencil
            rather than a row of buttons. */}
        {onEdit && (
          <button className="btn-icon" onClick={onEdit}
            title="Edit metadata" aria-label="Edit metadata">
            ✏
          </button>
        )}
      </h2>

      {(meta.length > 0 || readState) && (
        <p className="issue-identity__meta">
          {meta.map((part) => <span key={part}>{part}</span>)}
          {/* A finished comic says so in a word. A bar pinned at 100% invites you to work
              out what it means, and means the same thing either way. */}
          {readState === 'read' && <span className="issue-identity__read">Read</span>}
          {readState === 'reading' && typeof percent === 'number' && (
            <span className="issue-identity__progress">
              <span className="issue-identity__progress-bar">
                <span className="issue-identity__progress-fill" style={{ width: `${percent}%` }} />
              </span>
              {percent}%
            </span>
          )}
        </p>
      )}

      {(action || onRemove) && (
        <p className="issue-identity__actions">
          {action}
          {/* Last, and quiet. It deletes a file from disk, so it should never be the thing
              the eye lands on next to a row of arrows - but it asks before it does. Named
              as the issue's own page names it: on a volume page a bare "Remove" would sit
              a few inches from "Remove edition" and mean something very different. */}
          {onRemove && (
            <button type="button" className="issue-identity__remove" onClick={onRemove}>
              Remove issue
            </button>
          )}
        </p>
      )}
    </div>
  )
}
