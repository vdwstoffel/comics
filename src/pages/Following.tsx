import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiFollow, ApiLibraryBook, ApiUpcoming } from '../api'
import { groupByVolume, groupByArc } from '../lib/volumeGroups'
import type { FollowSoon } from '../lib/followStatus'
import { useUpcoming } from '../lib/useUpcoming'
import { upcomingForEdition } from '../lib/upcomingForEdition'
import LibraryRail from '../components/LibraryRail'
import VolumeGroupTile from '../components/VolumeGroupTile'
import ArcGroupTile from '../components/ArcGroupTile'
import FollowWaitingTile from '../components/FollowWaitingTile'

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
  const [next] = upcomingForEdition(upcoming.publishers.flatMap((p) => p.weeks), follow.edition)
  return next ? { state: 'next', week: next.week } : { state: 'none' }
}

/** The unread comics this follow holds: its edition's, or its arc's. */
function booksFor(follow: ApiFollow, books: ApiLibraryBook[]): ApiLibraryBook[] {
  return follow.kind === 'volume'
    ? books.filter((b) => b.editionId === follow.refId)
    : books.filter((b) => b.arcs.includes(follow.name))
}

export default function Following() {
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

  const unfollow = useMutation({
    mutationFn: ({ kind, refId }: { kind: 'volume' | 'arc'; refId: number }) => api.unfollow(kind, refId),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['follows'] }) },
  })

  const all = follows.data?.follows ?? []
  const unread = books.data?.books ?? []

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Following</h1>
        {(follows.isLoading || books.isLoading) && <p>Loading…</p>}
        {follows.error && <p>Failed to load what you follow.</p>}
        {books.error && <p>Failed to load your unread comics.</p>}
        {follows.data && books.data && all.length === 0 && (
          <p>Not following anything yet. Open a run or a story arc and press Follow.</p>
        )}
        {/* Held-or-waiting is only decidable once the unread books have arrived. Before
            that every follow would look empty, and the waiting tile would state - falsely -
            that nothing is there to read. */}
        <div className="tile-grid">
          {follows.data && books.data && all.map((follow) => {
            const held = booksFor(follow, unread)
            // The shelf draws the arc you follow, not whichever arc a tie-in happens to
            // list first: groupByArc credits a book to every arc it carries.
            const arcGroup = follow.kind === 'arc'
              ? groupByArc(held).arcs.find((a) => a.name === follow.name)
              : undefined
            const volumeGroup = follow.kind === 'volume' ? groupByVolume(held)[0] : undefined
            const tile = volumeGroup
              ? <VolumeGroupTile group={volumeGroup} showCount={false} />
              : arcGroup
                ? <ArcGroupTile group={arcGroup} showCount={false} />
                : null
            const soon = soonFor(follow, upcoming.data)
            return (
              // The tile is reused untouched; everything this page adds hangs off the
              // wrapper, so the library's own shelf never learns that following exists.
              <div className="follow-item" key={`${follow.kind}:${follow.refId}`}>
                {/* A status line only ever appears on a tile with no cover, where it IS
                    the tile. Beside a cover it was an extra line that only some follows
                    carried, and one that wrapped set the height of every tile in its row -
                    paid for by a sentence the cover had already answered. */}
                {tile ?? <FollowWaitingTile follow={follow} soon={soon} />}
                <button
                  type="button"
                  className="follow-item__unfollow"
                  aria-label={`Unfollow ${follow.name} (${follow.kind === 'arc' ? 'story arc' : 'run'})`}
                  onClick={() => unfollow.mutate({ kind: follow.kind, refId: follow.refId })}
                >
                  Unfollow
                </button>
              </div>
            )
          })}
        </div>
      </main>
    </>
  )
}
