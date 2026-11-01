import type { ReactNode } from 'react'
import type { ApiFollow } from '../api'
import { followStatus } from '../lib/followStatus'
import type { FollowSoon } from '../lib/followStatus'

interface FollowWaitingTileProps {
  follow: ApiFollow
  /** What the solicitation calendar had to say. Absent reads as "not asked yet". */
  soon?: FollowSoon
  /**
   * What to do about the comic this tile is waiting for, where there is anything to do.
   * A slot rather than props of its own, for the reason MissingIssueTile's upload is one:
   * only a follow whose next issue is named can offer anything, and most of them cannot.
   */
  action?: ReactNode
}

/**
 * A followed run or arc with nothing on the shelf to show for it.
 *
 * No cover, because there is nothing to open: a cover here would be either a spoiler for
 * an issue you have not read or a picture of one you have. The point of the tile is that
 * the follow is still alive - a shelf that hid everything it was waiting on would be
 * indistinguishable from one that had quietly forgotten.
 *
 * The control goes inside the blank rather than under it. The blank is the only empty
 * space on the tile and it is the very thing the control is about, which is the same
 * rule a gap in a run is drawn by.
 */
export default function FollowWaitingTile({ follow, soon, action }: FollowWaitingTileProps) {
  return (
    <div className="follow-waiting">
      <p className="follow-waiting__name">{follow.name}</p>
      <p className="follow-waiting__status">{followStatus(follow, soon)}</p>
      {action && <div className="follow-waiting__action">{action}</div>}
    </div>
  )
}
