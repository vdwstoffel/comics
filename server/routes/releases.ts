import { createComicVine } from '../lib/comicvine.js'
import { mostRecentWednesday, previousWednesday } from '../lib/releaseDay.js'
import {
  cacheRelease, getCachedRelease, getFreshRelease, findReleaseIssue, sortReleaseIssues,
} from '../models/releases.js'
import type { ReleaseIssue } from '../models/releases.js'
import { ownedIssueIds } from '../models/arcs.js'
import { getEditionByComicvineId } from '../models/editions.js'
import { findMatchForIssue } from '../services/issueMatching.js'
import { startIssueDownload, issueLabel } from '../services/issueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { getComicVineKey } from '../models/settings.js'
import type { App } from '../types.js'

/** The two publishers the tab is for. Exact strings: Comic Vine's own names. */
const SHOWN = ['Marvel', 'DC Comics'] as const

interface Query { refresh?: string }

export interface ReleaseRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

export default async function releaseRoutes(app: App, opts: ReleaseRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts
  // One client for the plugin's lifetime, not one per resolve() call: the client carries
  // the 1-request-per-second throttle state, and a fresh client per call would reset it,
  // letting the fallback's first request fire with no wait. The key is read per request
  // rather than captured, so a key entered in Settings applies without a restart.
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  app.get<{ Querystring: Query }>('/api/releases', async (req, reply) => {
    if (!getComicVineKey(app.db)) {
      return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    }
    const refresh = req.query?.refresh === '1'
    const now = new Date()

    /** A day's Marvel and DC issues, from the database if we hold them, else from Comic Vine. */
    async function resolve(day: string): Promise<{ issues: ReleaseIssue[]; fetchedAt: string; stale: boolean } | null> {
      if (!refresh) {
        // Whether what we hold is still good is getFreshRelease's decision alone - it
        // needs fetched_at, which only the read itself returns. See its comment for why
        // permanence is keyed on when we fetched rather than on the day being past.
        const held = getFreshRelease(app.db, day, now)
        if (held) return { ...held, stale: false }
      }

      try {
        const all = await cv.listIssuesOnSale(day)
        const volumeIds = [...new Set(all.map((i) => i.volumeId))]
        const publishers = await cv.getVolumePublishers(volumeIds)
        // Comic Vine's own response order is arbitrary and must not reach the caller -
        // sortReleaseIssues is the one place ordering is decided, the same one
        // getCachedRelease reads back through, so a cold response and a cached response
        // for the same day always agree.
        const kept = sortReleaseIssues(all.flatMap((issue) => {
          const publisher = publishers.get(issue.volumeId)
          // A volume whose publisher we failed to learn fails the filter and drops out.
          return publisher && (SHOWN as readonly string[]).includes(publisher)
            ? [{ ...issue, publisher }]
            : []
        }))
        const fetchedAt = now.toISOString()
        // byIds swallows a failed chunk, so a short map means we did not learn every publisher.
        // A real Wednesday is ~116 volumes = two chunks, so losing one drops about half the
        // day. Serving what we did learn is fine; recording the day as complete is not - a
        // settled day is read at any age and would never be asked about again, so a transient
        // /volumes/ failure would erase a real Wednesday for good. And what we serve is
        // flagged stale: a half-day presented as the whole day is the same lie either way.
        const complete = publishers.size === volumeIds.length
        if (complete) cacheRelease(app.db, day, kept, fetchedAt)
        return { issues: kept, fetchedAt, stale: !complete }
      } catch {
        // Whatever we hold beats nothing, however old it is.
        const anyAge = getCachedRelease(app.db, day, Infinity)
        return anyAge ? { ...anyAge, stale: true } : null
      }
    }

    let day = mostRecentWednesday(now)
    let held = await resolve(day)

    // Early on a Wednesday, before Comic Vine has been updated, the latest day is empty.
    // Step back exactly once: two empty Wednesdays report empty rather than recursing.
    //
    // Only a day we are confident about may step back. An incomplete publisher lookup can
    // empty a day that was not empty at all, and falling back then would hide a transient
    // Comic Vine failure behind a complete-looking "here is last Wednesday" - the user
    // shown last week's comics and told they are the latest. An empty day we are unsure
    // of reports itself, stale, rather than being answered with the wrong week.
    if (held && held.issues.length === 0 && !held.stale) {
      const earlier = previousWednesday(day)
      const fallback = await resolve(earlier)
      if (fallback && fallback.issues.length > 0) { day = earlier; held = fallback }
    }

    // Whichever resolve() call produced the day actually served is the one whose flags
    // count; the other call's outcome (in particular a fallback that found nothing at
    // all) must not leak onto a primary day that was served just fine.
    const unavailable = held == null
    const stale = held?.stale ?? false

    const owned = ownedIssueIds(app.db)
    const decorate = (issue: ReleaseIssue) => {
      const bookId = owned.get(issue.id)
      if (bookId != null) return { ...issue, owned: true, bookId }
      // Only what you are missing is worth matching; a match for a comic you already
      // have would be computed and thrown away.
      return {
        ...issue,
        owned: false,
        match: findMatchForIssue(app.db, issue.volumeName ?? null, {
          id: issue.id, number: issue.number, coverDate: issue.coverDate,
        }),
      }
    }

    const issues = held?.issues ?? []
    return {
      day,
      fetchedAt: held?.fetchedAt ?? null,
      ...(stale ? { stale: true } : {}),
      ...(unavailable ? { unavailable: true } : {}),
      publishers: SHOWN.map((name) => ({
        name,
        issues: issues.filter((i) => i.publisher === name).map(decorate),
      })),
    }
  })

  /**
   * Get an issue from the Latest tab in one press.
   *
   * Where it lands is decided by Comic Vine's volume id, not by the volume's name. The tab
   * lists every Marvel and DC issue of the day, and a brand-new issue of a series you
   * already own is not in `ownedIssueIds` - you do not have that issue yet - so it carries
   * a Get button too, and that is the common press. `edition.comicvine_id` IS the volume
   * id, so an edition you already have for the run is found by id and the file joins it
   * under its real name. Filing by the bare volume name instead would miss your
   * "Wolverine (2024)", create a second edition called "Wolverine" with its own folder,
   * and split the run across two places on disk.
   *
   * Only when no edition claims the volume does the name apply - which keeps the promise
   * for the case the tab was designed around, a series you own nothing of, where naming
   * the edition after the volume creates it.
   */
  app.post<{ Params: { cvIssueId: string } }>(
    '/api/releases/issues/:cvIssueId/download',
    async (req, reply) => {
      // Any age: a press only follows a page view that filled this cache, and a
      // published issue's number and cover date do not change.
      const issue = findReleaseIssue(app.db, Number(req.params.cvIssueId))
      if (!issue) return reply.code(404).send({ error: 'issue not in any cached release day' })

      const volumeName = issue.volumeName ?? null
      const existing = getEditionByComicvineId(app.db, issue.volumeId)
      const result = await startIssueDownload(app, {
        volumeName,
        editionName: existing?.name ?? volumeName ?? 'Unsorted',
        issue: { id: issue.id, number: issue.number, coverDate: issue.coverDate },
        label: issueLabel(issue.volumeName, issue.number),
        fetchPage,
      })
      // `reason` is the machine-readable half of the refusal: a client cannot tell a
      // no-match 409 from a duplicate one by string-matching the message.
      if (!result.ok) {
        return reply.code(result.code).send({ reason: result.reason, error: result.error, entry: result.entry })
      }
      return reply.code(202).send({ queued: true, entry: result.entry })
    },
  )
}
