import type { BulkRow } from './bulkMatch'

/**
 * Where one row has got to during a batch.
 *
 * `bare` is deliberately NOT a kind of `done`. The server answers 200 for a comic whose
 * Comic Vine read failed - storeComic swallows it on purpose, because a comic that landed
 * is worth more than the metadata it is missing - so a batch that exhausted Comic Vine's
 * hourly budget at file 60 would otherwise report "100 of 100" with forty bare comics in
 * it. The count has to be able to say that out loud.
 */
export type RowStatus = 'pending' | 'uploading' | 'done' | 'bare' | 'failed' | 'skipped'

export interface RowProgress {
  status: RowStatus
  percent?: number
  error?: string
  /** This row deleted the comic it replaced. Counted so the summary can account for it. */
  replaced?: boolean
  /** It landed, but the comic it should have replaced is still there. */
  replaceFailed?: boolean
}

export interface BatchCounts {
  /** Rows the button is about to send. */
  toUpload: number
  /** Of those, how many delete a comic you already have. */
  replacing: number
  /** Owned rows left unticked. */
  skipped: number
  /** Files that are not comics at all. */
  ignored: number
  /** Rows claimed by a volume but still without an issue. */
  needsIssue: number
}

/** Is this row one the Upload button will actually send? */
export function willUpload(row: BulkRow): boolean {
  if (row.state === 'ignored') return false
  if (row.state === 'owned-here' || row.state === 'owned-elsewhere') return row.replace
  // matched, needs-issue and unplaced all go up - an unmatched file still lands, and is
  // findable afterwards on the follow-up list.
  return true
}

export function countBatch(rows: BulkRow[]): BatchCounts {
  const owned = (r: BulkRow) => r.state === 'owned-here' || r.state === 'owned-elsewhere'
  return {
    toUpload: rows.filter(willUpload).length,
    replacing: rows.filter((r) => owned(r) && r.replace).length,
    skipped: rows.filter((r) => owned(r) && !r.replace).length,
    ignored: rows.filter((r) => r.state === 'ignored').length,
    needsIssue: rows.filter((r) => r.state === 'needs-issue').length,
  }
}

/** What the end-of-run summary says, from the progress map. */
export function summarise(progress: Record<string, RowProgress>) {
  const all = Object.values(progress)
  return {
    added: all.filter((p) => p.status === 'done').length,
    bare: all.filter((p) => p.status === 'bare').length,
    failed: all.filter((p) => p.status === 'failed').length,
    // The irreversible half of the run. The button warns before; this accounts after.
    replaced: all.filter((p) => p.replaced).length,
    replaceFailed: all.filter((p) => p.replaceFailed).length,
  }
}
