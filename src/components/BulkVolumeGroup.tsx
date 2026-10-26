import BulkIssuePicker from './BulkIssuePicker'
import { availableIssues } from '../lib/bulkMatch'
import type { BulkIssue, BulkRow, BulkVolume } from '../lib/bulkMatch'
import type { RowProgress } from '../lib/bulkProgress'

export interface BulkVolumeGroupProps {
  volume: BulkVolume
  /** What a batch of this volume files into - an existing edition's own name, where there is one. */
  editionName: string
  /** Every row in the batch: the picker needs them all to know which issues are taken. */
  allRows: BulkRow[]
  rows: BulkRow[]
  /** True when Comic Vine could not be read, so the list is empty for a reason worth saying. */
  unavailable?: boolean
  progress: Record<string, RowProgress>
  onPick: (key: string, issue: BulkIssue) => void
  onToggleReplace: (key: string) => void
}

function StateCell({ row }: { row: BulkRow }) {
  if (row.state === 'owned-elsewhere') {
    return (
      <span className="bulk-row__owned">
        #{row.issue?.number ?? '?'} · filed under {row.issue?.ownedIn?.editionName}
      </span>
    )
  }
  if (row.state === 'owned-here') {
    return <span className="bulk-row__owned">#{row.issue?.number ?? '?'} · already yours</span>
  }
  return (
    <span className="bulk-row__hit">
      ✓ #{row.issue?.number ?? '?'}{row.issue?.name ? ` ${row.issue.name}` : ''}
    </span>
  )
}

function ProgressCell({ at }: { at: RowProgress | undefined }) {
  if (!at || at.status === 'pending') return null
  if (at.status === 'uploading') return <span className="bulk-row__pct">Uploading… {at.percent ?? 0}%</span>
  if (at.status === 'done') return <span className="bulk-row__ok">✓ added</span>
  if (at.status === 'bare') return <span className="bulk-row__warn">landed without metadata</span>
  if (at.status === 'failed') return <span className="bulk-row__error">failed — {at.error}</span>
  return <span className="bulk-row__note">skipped</span>
}

/**
 * One volume's slice of the batch.
 *
 * Grouped by volume rather than listed flat so that a file sorted under the wrong heading
 * reads as wrong at a glance - a wrong issue number in a list of forty does not.
 */
export default function BulkVolumeGroup({
  volume, editionName, allRows, rows, unavailable, progress, onPick, onToggleReplace,
}: BulkVolumeGroupProps) {
  const matched = rows.filter((r) => r.issue != null).length
  const label = `${editionName} — ${volume.issues.length} issues, ${matched} matched`
  const free = availableIssues(allRows, volume)

  return (
    <section className="bulk-group" aria-label={label}>
      <header className="bulk-group__head">
        <strong>{volume.name}{volume.startYear ? ` (${volume.startYear})` : ''}</strong>
        <span className="bulk-group__meta">
          {volume.issues.length} issue{volume.issues.length === 1 ? '' : 's'} · {matched} matched ·
          {' '}files into {editionName}
        </span>
      </header>

      {unavailable && (
        <p className="bulk-group__warn">
          Comic Vine could not be read, so this volume has no issue list to match against.
          The files below will upload unmatched.
        </p>
      )}

      <ul className="bulk-group__rows">
        {rows.map((row) => (
          <li key={row.key} className={`bulk-row bulk-row--${row.state}`}>
            <span className="bulk-row__file">{row.fileName}</span>
            <span className="bulk-row__arrow">→</span>
            <span className="bulk-row__state">
              {row.state === 'needs-issue'
                ? <BulkIssuePicker fileName={row.fileName} issues={free} onPick={(i) => onPick(row.key, i)} />
                : <StateCell row={row} />}
              {(row.state === 'owned-here' || row.state === 'owned-elsewhere') && (
                <label className="bulk-row__replace">
                  <input
                    type="checkbox"
                    checked={row.replace}
                    aria-label={`Replace ${row.fileName}`}
                    onChange={() => onToggleReplace(row.key)}
                  />
                  {' '}replace
                </label>
              )}
            </span>
            <ProgressCell at={progress[row.key]} />
          </li>
        ))}
      </ul>
    </section>
  )
}
