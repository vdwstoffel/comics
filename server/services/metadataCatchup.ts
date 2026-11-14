import { CvApiError } from '../lib/comicvine.js'
import { listMetadataFollowups } from '../models/metadataFollowups.js'
import type { MetadataFollowup } from '../models/metadataFollowups.js'
import { getComicVineKey } from '../models/settings.js'
import { applyIssueToBook } from './applyIssue.js'
import type { Ctx } from '../types.js'

/**
 * One Comic Vine read every twenty seconds: 180 an hour, under the 200 an hour Comic Vine
 * allows, with room left for whatever a person is doing in the app at the same time.
 */
export const CATCHUP_INTERVAL_MS = 20_000
/**
 * How long to leave Comic Vine alone once it refuses. A refusal is nearly always the
 * hourly limit - a run of seven hundred comics filed in one go spends it in minutes - and
 * asking again every twenty seconds would only keep it spent.
 */
export const PAUSE_MS = 15 * 60_000
/**
 * How long before a comic Comic Vine answered for, but still thinly, is read again. A
 * record made the week a comic ships fills in over days; reading it every twenty seconds
 * meanwhile would spend the whole budget on the same few comics.
 */
export const RETRY_AFTER_MS = 3 * 24 * 60 * 60_000

export interface CatchupStatus {
  /** Comics that will be read again, now or when the pause ends. */
  due: number
  perHour: number
  /** While Comic Vine is being left alone, when it will be asked again. */
  pausedUntil: string | null
  /** What Comic Vine said when it refused. */
  reason: string | null
}

export interface MetadataCatchup {
  /** Read one comic, if one is due and Comic Vine is not being left alone. */
  tick(): Promise<'idle' | 'paused' | 'busy' | 'applied' | 'not-found' | 'refused'>
  status(): CatchupStatus
}

/**
 * Filling in, on its own, the metadata Comic Vine did not give when a comic was filed.
 *
 * What the Refresh button on the Missing metadata list does, done for every comic on that
 * list in turn and paced to Comic Vine's limit. It exists for a run filed in one go: seven
 * hundred comics spend Comic Vine's hourly budget in the first two hundred, and the rest
 * land filed, named and bound to their issue but bare. Catching those up by hand is five
 * hundred presses of Refresh; this is none.
 *
 * Only comics already bound to an issue - the list's own rule decides membership, so this
 * reads exactly what Refresh would offer. A dismissed comic is not on the list and is
 * never touched. Every read is the same apply Refresh makes, without `manual`, so it binds
 * nothing new and stamps no provenance.
 */
export function createMetadataCatchup(
  ctx: Ctx,
  { apply = applyIssueToBook, now = Date.now }: { apply?: typeof applyIssueToBook; now?: () => number } = {},
): MetadataCatchup {
  const { db } = ctx
  let pausedUntil = 0
  let reason: string | null = null
  let busy = false

  /**
   * The list's comics that have an id to read and have not been read lately, the ones
   * never tried first. Within those the list's own order holds - newest first - so a
   * run just filed is caught up before an old straggler.
   */
  function due(at: number): MetadataFollowup[] {
    const tried = new Map(
      (db.prepare('SELECT book_id, tried_at FROM metadata_catchup').all() as Array<{ book_id: number; tried_at: string }>)
        .map((r) => [r.book_id, Date.parse(r.tried_at)]),
    )
    const cutoff = at - RETRY_AFTER_MS
    return listMetadataFollowups(db)
      .filter((f) => f.bookCvId != null && (tried.get(f.bookId) ?? -Infinity) <= cutoff)
      .map((f, i) => ({ f, i, t: tried.get(f.bookId) ?? -Infinity }))
      .sort((a, b) => a.t - b.t || a.i - b.i)
      .map(({ f }) => f)
  }

  function markTried(bookId: number, at: number): void {
    db.prepare(`INSERT INTO metadata_catchup (book_id, tried_at) VALUES (?, ?)
                ON CONFLICT(book_id) DO UPDATE SET tried_at = excluded.tried_at`)
      .run(bookId, new Date(at).toISOString())
  }

  return {
    async tick() {
      if (busy) return 'busy'
      if (!getComicVineKey(db)) return 'idle'
      const at = now()
      if (at < pausedUntil) return 'paused'
      const [next] = due(at)
      if (!next) return 'idle'

      busy = true
      try {
        await apply(ctx, next.bookId, next.bookCvId!)
        // Marked whether or not the record was complete. Complete, the comic has left the
        // list and the mark is never read; still thin, it waits its three days.
        markTried(next.bookId, at)
        reason = null
        return 'applied'
      } catch (err) {
        // An id Comic Vine does not have is the comic's problem, not Comic Vine's: it stays
        // on the list for a person, and is not asked about again for a while.
        if (err instanceof CvApiError && err.cvStatus === 101) {
          markTried(next.bookId, at)
          return 'not-found'
        }
        // Anything else is Comic Vine refusing or unreachable. Nothing was written and the
        // comic is not marked, so it is the first one read when the pause ends.
        pausedUntil = at + PAUSE_MS
        reason = err instanceof Error ? err.message : String(err)
        return 'refused'
      } finally {
        busy = false
      }
    },

    status() {
      const at = now()
      const paused = at < pausedUntil
      return {
        due: due(at).length,
        perHour: Math.round(3_600_000 / CATCHUP_INTERVAL_MS),
        pausedUntil: paused ? new Date(pausedUntil).toISOString() : null,
        reason: paused ? reason : null,
      }
    },
  }
}

/** Starts reading, one comic every interval. */
export function startMetadataCatchup(catchup: MetadataCatchup, intervalMs = CATCHUP_INTERVAL_MS): void {
  // unref: catching up is never a reason for the process to stay alive.
  setInterval(() => { void catchup.tick().catch(() => { /* tick reports its own */ }) }, intervalMs).unref()
}
