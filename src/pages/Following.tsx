import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiFollow, ApiLibraryBook } from '../api'
import { groupByVolume, groupByArc } from '../lib/volumeGroups'
import { followStatus } from '../lib/followStatus'
import LibraryRail from '../components/LibraryRail'
import VolumeGroupTile from '../components/VolumeGroupTile'
import ArcGroupTile from '../components/ArcGroupTile'
import FollowWaitingTile from '../components/FollowWaitingTile'

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
              ? <VolumeGroupTile group={volumeGroup} />
              : arcGroup
                ? <ArcGroupTile group={arcGroup} />
                : null
            const status = followStatus(follow)
            return (
              // The tile is reused untouched; everything this page adds hangs off the
              // wrapper, so the library's own shelf never learns that following exists.
              <div className="follow-item" key={`${follow.kind}:${follow.refId}`}>
                {tile ?? <FollowWaitingTile follow={follow} />}
                {/* On a tile that already draws a comic, the status is the extra line;
                    on a waiting tile it is the tile, so it is not repeated here. */}
                {tile && status && <p className="follow-item__status">{status}</p>}
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
