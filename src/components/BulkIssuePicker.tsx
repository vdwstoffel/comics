import type { BulkIssue } from '../lib/bulkMatch'

export interface BulkIssuePickerProps {
  /** The file this picks for. Carried as the control's accessible name. */
  fileName: string
  /** Only the issues no other row has taken - offering one twice invites a collision. */
  issues: BulkIssue[]
  onPick: (issue: BulkIssue) => void
}

/**
 * Choosing the issue for a file the matcher could not place.
 *
 * A select over the volume's own issues rather than another Comic Vine search: the
 * volume is already known by the time a row can be in this state, so the fix is one
 * click on a short list instead of a second search and an id to read.
 */
export default function BulkIssuePicker({ fileName, issues, onPick }: BulkIssuePickerProps) {
  if (!issues.length) {
    return <span className="bulk-row__note">No issues of this volume are left to pick.</span>
  }
  return (
    <select
      className="bulk-row__picker"
      aria-label={`Pick an issue for ${fileName}`}
      defaultValue=""
      onChange={(e) => {
        const issue = issues.find((i) => String(i.id) === e.target.value)
        if (issue) onPick(issue)
      }}
    >
      <option value="" disabled>⚠ pick an issue</option>
      {issues.map((issue) => (
        <option key={issue.id} value={issue.id}>
          #{issue.number ?? '?'}{issue.name ? ` — ${issue.name}` : ''}
        </option>
      ))}
    </select>
  )
}
