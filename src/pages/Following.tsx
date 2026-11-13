import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiFollow, ApiLibraryBook, ApiUpcoming, FollowKind } from '../api'
import { groupByVolume, groupByArc } from '../lib/volumeGroups'
import type { FollowSoon } from '../lib/followStatus'
import { useUpcoming } from '../lib/useUpcoming'
import { sortFollows, bandOf, monthOf, oldestMonth } from '../lib/followOrder'
import type { FollowSort } from '../lib/followOrder'
import { useFollowSort } from '../lib/useFollowSort'
import { useDocumentTitle } from '../lib/useDocumentTitle'
import { upcomingForEdition } from '../lib/upcomingForEdition'
import { writeOutShortDay } from '../lib/releaseWeek'
import LibraryRail from '../components/LibraryRail'
import VolumeGroupTile from '../components/VolumeGroupTile'
import ArcGroupTile from '../components/ArcGroupTile'
import FollowWaitingTile from '../components/FollowWaitingTile'
import FollowUpcomingTile from '../components/FollowUpcomingTile'
import FollowGapTile from '../components/FollowGapTile'

/**
 * The shelf's three headings, in the order they are drawn: what you can open now, what
 * has a date, and what can say neither. An empty one is left out entirely rather than
 * printed over nothing - "Coming soon" above a blank strip reads as a page that failed.
 */
const BANDS = [
  { id: 'available', title: 'Available' },
  { id: 'coming', title: 'Coming soon' },
  { id: 'undated', title: 'No date yet' },
] as const

/**
 * What the solicitation calendar knows about the issue after this follow's last.
 *
 * Only a run can be answered: the calendar is a list of volumes and issue numbers, and an
 * arc is neither - its next part could be solicited under any title in the line. Saying
 * "no further details" for one is not a shrug, it is the whole truth available.
 *
 * Every publisher's weeks together, as the volume page reads them: which publisher
 * solicited an issue is not something this line says, and DC's list is empty anyway.
 */
function soonFor(follow: ApiFollow, upcoming: ApiUpcoming | undefined): FollowSoon {
  // No data covers both "still loading" and "Marvel could not be read". Neither is being
  // told that nothing is coming, and only that may be repeated to a reader.
  if (!upcoming) return { state: 'pending' }
  if (!follow.edition) return { state: 'none' }

  // Sorted by week already, so the first row is the soonest - which is the only one a
  // single line has room for, and the only one "next" can mean.
  const weeks = upcoming.publishers.flatMap((p) => p.weeks)
  const [next] = upcomingForEdition(weeks, follow.edition)
  if (!next) return { state: 'none' }

  // The solicitation's own row, read back by the id it was matched on. upcomingForEdition
  // answers the matching rule and hands back only what that rule reads, because the
  // volume page shares it and wants no art there; the art is this page's business alone.
  const row = weeks.flatMap((w) => w.issues).find((i) => i.sourceId === next.sourceId)
  return {
    state: 'next',
    week: next.week,
    cover: row?.coverUrl ? { url: row.coverUrl, siteUrl: row.siteUrl } : undefined,
  }
}

/** The unread comics this follow holds: its edition's, its arc's, or its reading list's. */
function booksFor(follow: ApiFollow, books: ApiLibraryBook[]): ApiLibraryBook[] {
  if (follow.kind === 'volume') return books.filter((b) => b.editionId === follow.refId)
  if (follow.kind === 'arc') return books.filter((b) => b.arcs.includes(follow.name))
  // In the order the list reads rather than the shelf's, so the cover is the next one up.
  const order = new Map((follow.list?.issueIds ?? []).map((id, i) => [id, i]))
  return books
    .filter((b) => b.comicvineId != null && order.has(b.comicvineId))
    .sort((a, b) => order.get(a.comicvineId!)! - order.get(b.comicvineId!)!)
}

/** How the unfollow button names what it unfollows. */
const KIND_NAMES: Record<FollowKind, string> = { volume: 'run', arc: 'story arc', list: 'reading list' }

export default function Following() {
  useDocumentTitle('Following')
  const queryClient = useQueryClient()
  const follows = useQuery({ queryKey: ['follows'], queryFn: api.getFollows })
  // The same shelf query the library makes, so the two pages share a cache entry and
  // drawing a followed run costs nothing the library had not already paid for.
  const books = useQuery({
    queryKey: ['library-books', null, 'unread'],
    queryFn: () => api.getLibraryBooks({ readState: 'unread', publisher: null }),
  })

  // Shares a query key with the Upcoming tab and with every volume's Coming soon list, so
  // a shelf full of follows reads the calendar once - and names the same dates it does.
  const upcoming = useUpcoming()
  const [sort, chooseSort] = useFollowSort()

  const unfollow = useMutation({
    mutationFn: ({ kind, refId }: { kind: FollowKind; refId: number }) => api.unfollow(kind, refId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['follows'] }) },
  })

  const all = follows.data?.follows ?? []
  const unread = books.data?.books ?? []

  // What the shelf has worked out about each follow: the tile to draw, and the two facts
  // the running order is decided on. Both are browser-side - the server lists follows
  // alphabetically and knows neither your unread shelf nor Marvel's calendar - so the
  // order is settled here, with that alphabetical list left to break ties inside each band.
  const shelf = sortFollows(all.map((follow) => {
    const held = booksFor(follow, unread)
    // The shelf draws the arc you follow, not whichever arc a tie-in happens to
    // list first: groupByArc credits a book to every arc it carries.
    const arcGroup = follow.kind === 'arc'
      ? groupByArc(held).arcs.find((a) => a.name === follow.name)
      : undefined
    const volumeGroup = follow.kind === 'volume' ? groupByVolume(held)[0] : undefined
    // A list crosses series the way an arc does, so it is drawn as one: the deck of what
    // you hold, opening the list rather than a comic.
    const listGroup = follow.kind === 'list' && follow.list && held.length > 0
      ? { name: follow.name, books: held, seriesCount: new Set(held.map((b) => b.editionId)).size }
      : undefined
    const tile = volumeGroup
      ? <VolumeGroupTile group={volumeGroup} showCount={false} />
      : arcGroup
        ? <ArcGroupTile group={arcGroup} showCount={false} />
        : listGroup
          ? <ArcGroupTile group={listGroup} showCount={false} to={`/lists/${encodeURIComponent(follow.list!.slug)}`} />
          : null
    // Dated by the oldest comic the tile holds - the one on its cover - or by the issue that
    // is out when there is no tile. Only read when Available is sorted by cover date.
    const coverDate = tile ? oldestMonth(held.map((b) => b.date)) : monthOf(follow.want?.coverDate)
    return { follow, tile, hasTile: tile != null, soon: soonFor(follow, upcoming.data), coverDate }
  }), sort)

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        {/* Page-wide, though only Available moves: Coming soon is in date order already
            and No date yet has nothing to sort on. */}
        <div className="following-header">
          <h1 className="page-title">Following</h1>
          <label className="following-sort">
            Sort
            <select value={sort} onChange={(e) => chooseSort(e.target.value as FollowSort)}>
              <option value="name">Name</option>
              <option value="date">Cover date</option>
            </select>
          </label>
        </div>
        {(follows.isLoading || books.isLoading) && <p>Loading…</p>}
        {follows.error && <p>Failed to load what you follow.</p>}
        {books.error && <p>Failed to load your unread comics.</p>}
        {follows.data && books.data && all.length === 0 && (
          <p>Not following anything yet. Open a run, a story arc or a reading list and press Follow.</p>
        )}
        {/* Held-or-waiting is only decidable once the unread books have arrived. Before
            that every follow would look empty, and the waiting tile would state - falsely -
            that nothing is there to read. */}
        {follows.data && books.data && BANDS.map(({ id, title }) => {
          const items = shelf.filter((item) => bandOf(item) === id)
          if (items.length === 0) return null
          return (
            <section className="follow-band" key={id}>
              <h2 className="shelf-heading">{title}</h2>
              <div className="tile-grid">
                {items.map(({ follow, tile, soon }) => {
                  // Dated art is drawn under the dated heading and nowhere else. The
                  // section decides rather than `soon` alone, because a follow can carry
                  // a solicitation its tile never shows - a dormant run is sorted and
                  // captioned on what you have not read, not on what Marvel announced -
                  // and a cover with a date on it is that date, stated.
                  const dated = id === 'coming' && soon.state === 'next' ? soon : undefined
                  return (
                    // The tile is reused untouched; everything this page adds hangs off the
                    // wrapper, so the library's own shelf never learns that following exists.
                    <div className="follow-item" key={`${follow.kind}:${follow.refId}`}>
                      {/* A status line only ever appears on a tile with no cover, where it IS
                          the tile. Beside a cover it was an extra line that only some follows
                          carried, and one that wrapped set the height of every tile in its row -
                          paid for by a sentence the cover had already answered. */}
                      {tile ?? (dated?.cover
                        ? (
                          <FollowUpcomingTile
                            name={follow.name}
                            date={writeOutShortDay(dated.week)}
                            coverUrl={dated.cover.url}
                            siteUrl={dated.cover.siteUrl}
                          />
                        )
                        // An issue that is published and unmatched is the one thing on
                        // this page a reader can act on, so it is the one blank that
                        // carries a control. Every other blank is waiting on somebody
                        // else and has nothing to offer.
                        : follow.state === 'wanted'
                          ? <FollowGapTile follow={follow} soon={soon} />
                          : <FollowWaitingTile follow={follow} soon={soon} />)}
                      <button
                        type="button"
                        className="follow-item__unfollow"
                        aria-label={`Unfollow ${follow.name} (${KIND_NAMES[follow.kind]})`}
                        onClick={() => unfollow.mutate({ kind: follow.kind, refId: follow.refId })}
                      >
                        Unfollow
                      </button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </main>
    </>
  )
}
