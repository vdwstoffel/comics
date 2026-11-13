import type { BulkIssue, BulkVolume } from '../lib/bulkMatch'

/** One chosen volume's issues that are still free to pick. */
export interface LeftoverGroup {
  volume: BulkVolume
  issues: BulkIssue[]
}

export interface BulkLeftoverPickerProps {
  /** The file this picks for. Carried as the control's accessible name. */
  fileName: string
  /** Every chosen volume, each with only the issues no other row has taken. */
  groups: LeftoverGroup[]
  onPick: (volume: BulkVolume, issue: BulkIssue) => void
}

/**
 * Placing a file no volume would claim, by hand.
 *
 * A volume claims a file only when the names agree, and that refusal is right - but a name
 * the parser cannot read, or a release named its own way, would then have nowhere to go
 * but up unmatched. This is the way in: every chosen volume's free issues in one list,
 * headed by volume, so picking one is a single choice rather than a volume and then an
 * issue.
 */
export default function BulkLeftoverPicker({ fileName, groups, onPick }: BulkLeftoverPickerProps) {
  const offered = groups.filter((g) => g.issues.length > 0)
  if (!offered.length) {
    return <span className="bulk-row__note">No issues of the chosen volumes are left to pick.</span>
  }
  return (
    <select
      className="bulk-row__picker"
      aria-label={`Pick an issue for ${fileName}`}
      defaultValue=""
      onChange={(e) => {
        for (const { volume, issues } of offered) {
          const issue = issues.find((i) => String(i.id) === e.target.value)
          if (issue) return onPick(volume, issue)
        }
      }}
    >
      <option value="" disabled>pick an issue</option>
      {offered.map(({ volume, issues }) => (
        <optgroup key={volume.volumeId} label={`${volume.name}${volume.startYear ? ` (${volume.startYear})` : ''}`}>
          {issues.map((issue) => (
            <option key={issue.id} value={issue.id}>
              #{issue.number ?? '?'}{issue.name ? ` — ${issue.name}` : ''}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  )
}
