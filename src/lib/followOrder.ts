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
  /**
   * The month this follow is dated by when Available is sorted by cover date: the oldest
   * comic its tile holds, or the issue that is out. `YYYY-MM` - see `monthOf`.
   */
  coverDate?: string
}

/** How Available is ordered. Name is the shelf as it always was. */
export type FollowSort = 'name' | 'date'

/**
 * A cover date to the month. Comic Vine dates a want to the day and a comic's own file
 * to the month; compared as they come, `2027-01` sorts before `2027-01-01` and one month
 * splits in two. The month is also all a cover date really says.
 */
export function monthOf(date: string | null | undefined): string | undefined {
  return date ? date.slice(0, 7) : undefined
}

/**
 * The oldest of these cover dates, to the month. For a run's unread comics that is the
 * one on its cover - the tile leads with the next issue to read - so the date a run is
 * sorted on is the date of the comic you can see.
 */
export function oldestMonth(dates: Array<string | null | undefined>): string | undefined {
  let oldest: string | undefined
  for (const date of dates) {
    const month = monthOf(date)
    if (month && (!oldest || month < oldest)) oldest = month
  }
  return oldest
}

/** Oldest cover first, and a follow with no date after every one that has one. */
function byCoverDate(a: OrderableFollow, b: OrderableFollow): number {
  if (!a.coverDate || !b.coverDate) return (a.coverDate ? 0 : 1) - (b.coverDate ? 0 : 1)
  return a.coverDate.localeCompare(b.coverDate)
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
 * Which of the shelf's three headed sections a follow is drawn under.
 *
 * A coarsening of the bands above rather than a second rule, so a follow can never be
 * filed under a heading its tile disagrees with: `coming` is exactly the set `tierOf`
 * dates, which is exactly the set whose tile reads `Next:`.
 *
 * `available` reads as "this comic exists", not "this comic is on your shelf": an issue
 * that is out and merely unmatched is published, and the heading it used to sit under
 * said the opposite. It keeps its place behind the runs you can actually open - that is
 * still tier 0 before tier 1, decided by `sortFollows` and left alone here - and it is
 * the one tile on the shelf that carries a control, because it is the one a reader can
 * do something about.
 *
 * Only tier 3 is left undated: a follow that cannot name an issue at all.
 */
export type FollowBand = 'available' | 'coming' | 'undated'

export function bandOf(item: OrderableFollow): FollowBand {
  const tier = tierOf(item)
  if (tier === 0 || tier === 1) return 'available'
  return tier === 2 ? 'coming' : 'undated'
}

/**
 * The shelf's running order, as a new array.
 *
 * Name breaks every tie, so the alphabetical scan the shelf used to be survives inside
 * each band. Weeks are `YYYY-MM-DD`, which sorts chronologically as text; outside the
 * dated band both sides are empty and the comparison simply falls through to the name.
 *
 * By `date`, Available runs oldest cover first, and an issue that is out takes its place
 * among the runs by its own date: the band reads "this comic exists", so by date the two
 * tiers are one list. A follow with no date goes to the end of the band, not past it. The
 * other two bands are untouched - one is in date order already, the other has none.
 */
export function sortFollows<T extends OrderableFollow>(items: T[], sort: FollowSort = 'name'): T[] {
  return [...items].sort((a, b) => (
    (sort === 'date' && bandOf(a) === 'available' && bandOf(b) === 'available'
      ? byCoverDate(a, b)
      : tierOf(a) - tierOf(b))
    || weekOf(a).localeCompare(weekOf(b))
    || a.follow.name.localeCompare(b.follow.name, undefined, { sensitivity: 'base' })
  ))
}
