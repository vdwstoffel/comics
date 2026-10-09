import type { ApiFollow } from '../api'
import type { FollowSoon } from './followStatus'

/**
 * A follow as the shelf has worked it out: the row itself, whether it drew a cover, and
 * what the solicitation calendar said. All three are browser-side facts - the server
 * knows neither your unread shelf nor Marvel's calendar - which is why the order is
 * decided here rather than in the SQL that lists follows.
 */
export interface OrderableFollow {
  follow: ApiFollow
  /** Whether the page drew a cover for it, which is to say there is something to read. */
  hasTile: boolean
  soon: FollowSoon
}

/**
 * Which band a follow belongs to, most actionable first: a comic waiting to be read, an
 * issue that is out and merely unposted, a date to look forward to, and then everything
 * that cannot say when.
 *
 * The dated band asks for `caught-up` and not just a week, because `followStatus` prints
 * `Next:` for a caught-up follow alone. Ranking on a solicitation the tile never shows
 * would file a dormant follow among the dated rows while it displayed no date at all.
 */
function tierOf(item: OrderableFollow): number {
  if (item.hasTile) return 0
  if (item.follow.state === 'wanted') return 1
  return weekOf(item) ? 2 : 3
}

/** The week this follow is sorted on, or `''` for one that shows no date. */
function weekOf(item: OrderableFollow): string {
  const { follow, soon } = item
  return follow.state === 'caught-up' && soon.state === 'next' ? soon.week : ''
}

/**
 * The shelf's running order, as a new array.
 *
 * Name breaks every tie, so the alphabetical scan the shelf used to be survives inside
 * each band. Weeks are `YYYY-MM-DD`, which sorts chronologically as text; outside the
 * dated band both sides are empty and the comparison simply falls through to the name.
 */
export function sortFollows<T extends OrderableFollow>(items: T[]): T[] {
  return [...items].sort((a, b) => (
    tierOf(a) - tierOf(b)
    || weekOf(a).localeCompare(weekOf(b))
    || a.follow.name.localeCompare(b.follow.name, undefined, { sensitivity: 'base' })
  ))
}
