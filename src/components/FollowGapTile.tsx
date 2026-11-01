import { api } from '../api'
import type { ApiFollow } from '../api'
import type { FollowSoon } from '../lib/followStatus'
import { findIssueSeed } from '../lib/findIssueSeed'
import { useFindRelease } from '../lib/useFindRelease'
import FollowWaitingTile from './FollowWaitingTile'
import IssueAction from './IssueAction'

interface FollowGapTileProps {
  /** A `wanted` follow. Anything else has no issue to name and nothing to fetch. */
  follow: ApiFollow
  soon?: FollowSoon
}

/**
 * A followed run whose next issue is published and not in the library: the waiting blank,
 * plus the one control that can fill it.
 *
 * A component of its own because `useFindRelease` is a hook and the shelf draws one of
 * these per follow - the same reason the releases tab wraps its own gap in one.
 *
 * Find rather than Get, always. Get is the offer made when exactly one scraped row can be
 * this issue, and the sweep has already run that rule against this very issue: a follow
 * that is still `wanted` rather than `queued` is one it could not match. Offering Get
 * here would be offering a press that has already been tried on your behalf.
 */
export default function FollowGapTile({ follow, soon }: FollowGapTileProps) {
  const want = follow.want
  // Comic Vine's name for the run first - it is what the index is matched on - then the
  // edition's own, and the follow's name last. An arc follow has no edition at all, and
  // its name is the crossover rather than the run the missing tie-in belongs to.
  const series = want?.seriesName || follow.edition?.seriesName || follow.edition?.name || follow.name
  const label = want?.number ? `${series} #${want.number}` : series

  const find = useFindRelease({
    gapLabel: label,
    seed: findIssueSeed(series, want?.coverDate ?? undefined),
    // Each kind goes to the route that reads the cache its want came from: a volume
    // follow's refId is the edition id, and an arc's gap is found by issue id alone
    // because the tie-in belongs to some other run entirely.
    onDownload: (indexId) => (follow.kind === 'arc'
      ? api.downloadArcIssue(want!.id, indexId)
      : api.downloadMissingIssue(follow.refId, want!.id, indexId)),
  })

  return (
    <>
      <FollowWaitingTile
        follow={follow}
        soon={soon}
        action={(
          <IssueAction
            label={label}
            hasMatch={false}
            onFind={find.onFind}
            // Never reached: `hasMatch` is false above and stays false, so IssueAction
            // draws Find or Queued and never the Get this would run.
            onGet={() => {}}
            pending={false}
            failed={false}
            queued={follow.queued}
          />
        )}
      />
      {find.dialog}
    </>
  )
}
