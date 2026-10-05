import type { ApiFollow } from '../api'
import { followStatus } from '../lib/followStatus'

interface FollowWaitingTileProps {
  follow: ApiFollow
}

/**
 * A followed run or arc with nothing on the shelf to show for it.
 *
 * No cover, because there is nothing to open: a cover here would be either a spoiler for
 * an issue you have not read or a picture of one you have. The point of the tile is that
 * the follow is still alive - a shelf that hid everything it was waiting on would be
 * indistinguishable from one that had quietly forgotten.
 */
export default function FollowWaitingTile({ follow }: FollowWaitingTileProps) {
  return (
    <div className="follow-waiting">
      <p className="follow-waiting__name">{follow.name}</p>
      <p className="follow-waiting__status">{followStatus(follow)}</p>
    </div>
  )
}
