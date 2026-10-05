import { createComicVine } from '../lib/comicvine.js'
import type { ComicVineClient, CvStoryArc } from '../lib/comicvine.js'
import { listStoryArcs, ownedIssueIds } from '../models/arcs.js'
import { cacheArc, getCachedArc, findArcIssue } from '../models/arcCache.js'
import { getArcOrder, saveArcOrder, clearArcOrder } from '../models/arcOrder.js'
import { applySavedOrder } from '../lib/arcOrder.js'
import { resolveArcId } from '../services/arcIdentity.js'
import { findMatchForIssue } from '../services/issueMatching.js'
import { startIssueDownload, issueLabel } from '../services/issueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { getEditionByComicvineId } from '../models/editions.js'
import { getBookTags } from '../models/metadata.js'
import { getBook } from '../models/books.js'
import { deriveReadState } from '../models/progress.js'
import { getComicVineKey } from '../models/settings.js'
import type { App, Db } from '../types.js'

interface NameParams { name: string }
interface IdParams { id: string }
interface RefreshQuery { refresh?: string }

interface LoadedArc {
  arc: CvStoryArc
  fetchedAt: string
  /** The run we hold is older than the policy allows, because Comic Vine would not answer. */
  stale: boolean
  /** The order is one you arranged, not the one dates computed. */
  ordered: boolean
}

/**
 * An arc's run, from the cache when we hold a fresh one and from Comic Vine otherwise.
 *
 * Reading a run costs one request for the arc plus a chunked read of its issues' dates, so
 * without this both the arc page and every issue's "Part 2 of 6" line would spend that on
 * every single view, against a budget of 200 requests an hour. `refresh` forces a re-read
 * for a running arc that has gained an issue since.
 *
 * Returns undefined only when Comic Vine will not answer AND we hold nothing at all -
 * a run of any age beats no run.
 */
async function loadArc(
  db: Db,
  cv: ComicVineClient,
  arcId: number,
  refresh = false,
): Promise<LoadedArc | undefined> {
  const found = await readArc(db, cv, arcId, refresh)
  if (!found) return undefined

  // Your arrangement is applied HERE rather than in either handler, so the arc page and
  // the "Part 2 of 6" line under an issue's Read button can never disagree about the run.
  // An empty arrangement leaves the computed order exactly as it was.
  const saved = getArcOrder(db, arcId)
  return {
    ...found,
    ordered: saved.length > 0,
    arc: { ...found.arc, issues: applySavedOrder(found.arc.issues, saved) },
  }
}

/** The run as Comic Vine has it, cache first. Knows nothing about how you arranged it. */
async function readArc(
  db: Db,
  cv: ComicVineClient,
  arcId: number,
  refresh: boolean,
): Promise<Omit<LoadedArc, 'ordered'> | undefined> {
  if (!refresh) {
    const fresh = getCachedArc(db, arcId)
    if (fresh) return { ...fresh, stale: false }
  }
  try {
    const arc = await cv.getStoryArc(arcId)
    const fetchedAt = new Date().toISOString()
    cacheArc(db, arcId, arc, fetchedAt)
    return { arc, fetchedAt, stale: false }
  } catch {
    const anyAge = getCachedArc(db, arcId, Infinity)
    return anyAge ? { ...anyAge, stale: true } : undefined
  }
}

export interface ArcRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

export default async function arcRoutes(app: App, opts: ArcRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  // Which arcs the library knows about is a question about the library, so it never
  // touches Comic Vine.
  app.get('/api/arcs', async () => ({ arcs: listStoryArcs(app.db) }))

  app.get<{ Params: NameParams; Querystring: RefreshQuery }>('/api/arcs/:name', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const name = decodeURIComponent(req.params.name)

    const resolved = await resolveArcId(app.db, cv, name)
    if ('code' in resolved) return reply.code(resolved.code).send({ error: resolved.error })
    const extId = resolved.id

    const loaded = await loadArc(app.db, cv, extId, req.query?.refresh === '1')
    if (!loaded) return reply.code(502).send({ error: 'Comic Vine would not answer for this arc' })

    const owned = ownedIssueIds(app.db)

    return {
      // The arc's own Comic Vine id, which the page needs to unfollow it. Computed here
      // already; it was simply never sent.
      arcId: extId,
      stale: loaded.stale,
      fetchedAt: loaded.fetchedAt,
      ordered: loaded.ordered,
      arc: {
        ...loaded.arc,
        // An issue you own carries its read state, so the arc draws the same badges the
        // edition grid does. One you do not own has no read state to report.
        issues: loaded.arc.issues.map((issue) => {
          const bookId = owned.get(issue.id)
          // Only what you are missing is worth matching; a match for a comic you already
          // have would be computed and thrown away. The match keys on the issue's OWN
          // volume name rather than the arc's: most of what an arc is missing is tie-ins,
          // which belong to other volumes entirely.
          if (bookId == null) {
            return { ...issue, owned: false, match: findMatchForIssue(app.db, issue.volumeName ?? null, issue) }
          }
          const book = getBook(app.db, bookId)
          if (!book) return { ...issue, owned: true, bookId }
          const { readState, percent } = deriveReadState(app.db, book)
          return { ...issue, owned: true, bookId, readState, percent }
        }),
      },
    }
  })

  /**
   * Put this arc in the order you say it reads in.
   *
   * The body is the WHOLE run, not a move: the page sends back every issue it drew, in the
   * order it now shows them. That is what makes the result independent of what Comic Vine
   * does next - an issue added to the arc afterwards is placed against these by date rather
   * than needing the arrangement to be expressed as offsets from a list that has shifted.
   */
  app.put<{ Params: NameParams; Body: { issueIds?: unknown } }>(
    '/api/arcs/:name/order',
    async (req, reply) => {
      const name = decodeURIComponent(req.params.name)
      const ids = req.body?.issueIds
      // A malformed body would otherwise save an empty order, which reads as "never
      // arranged" and silently throws away the arrangement the page meant to send.
      if (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id))) {
        return reply.code(400).send({ error: 'issueIds must be a list of Comic Vine issue ids' })
      }

      const resolved = await resolveArcId(app.db, cv, name)
      if ('code' in resolved) return reply.code(resolved.code).send({ error: resolved.error })

      saveArcOrder(app.db, resolved.id, ids as number[])
      return { ordered: true }
    },
  )

  /** Forget your arrangement and go back to the order dates compute. */
  app.delete<{ Params: NameParams }>('/api/arcs/:name/order', async (req, reply) => {
    const name = decodeURIComponent(req.params.name)
    const resolved = await resolveArcId(app.db, cv, name)
    if ('code' in resolved) return reply.code(resolved.code).send({ error: resolved.error })

    clearArcOrder(app.db, resolved.id)
    return { ordered: false }
  })

  /**
   * Where this issue sits in each arc it carries - the "Part 2 of 6" under the Read button.
   *
   * Its own endpoint rather than part of the book payload, so opening an issue never waits
   * on Comic Vine: the page renders and this fills in behind it. Everything here degrades
   * to naming the arc without placing it, because a detail page that cannot reach Comic
   * Vine should still say the issue belongs to a story.
   */
  app.get<{ Params: IdParams; Querystring: RefreshQuery }>('/api/books/:id/arcs', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })

    const tags = getBookTags(app.db, book.id).filter((t) => t.kind === 'story_arc')
    const refresh = req.query?.refresh === '1'

    const arcs = []
    for (const tag of tags) {
      // With no arc id there is nothing to look up, and with no Comic Vine id for the book
      // there is nothing to find it by - either way, name the arc and spend no request.
      if (tag.extId == null || book.comicvineId == null) {
        arcs.push({ name: tag.value, arcId: tag.extId })
        continue
      }
      const loaded = await loadArc(app.db, cv, tag.extId, refresh)
      if (!loaded) {
        arcs.push({ name: tag.value, arcId: tag.extId })
        continue
      }
      // A tie-in can carry an arc tag that the arc itself does not list back. Reporting
      // "Part 0 of 9" would be a lie, so it keeps the name and loses the position.
      const at = loaded.arc.issues.findIndex((i) => i.id === book.comicvineId)
      arcs.push({
        name: tag.value,
        arcId: tag.extId,
        ...(at === -1 ? {} : { position: at + 1 }),
        total: loaded.arc.issues.length,
        ...(loaded.arc.siteUrl ? { siteUrl: loaded.arc.siteUrl } : {}),
      })
    }

    return { arcs }
  })

  /**
   * Download the one scraped release that is this missing arc issue.
   *
   * An arc is not a shelf: its issues come from the series it is named for and from every
   * volume that tied in, so where the file lands is decided per issue, by the same rule
   * the Latest tab applies. An edition that already claims the Comic Vine volume takes it
   * - filing by the bare volume name would miss the run you have and split it across two
   * folders - and otherwise the volume's own name creates the edition, which is what makes
   * filling a tie-in you own nothing of predictable.
   *
   * The match is re-derived here rather than taken from the page, for the reason the
   * edition route gives: a rescrape between the render and the press must not be able to
   * turn a button into a download of something else.
   *
   * Arcs cached before the volume id was stored carry only the name; those fall back to
   * it rather than leaving the button dead until the arc happens to be refreshed.
   */
  app.post<{ Params: { cvIssueId: string } }>(
    '/api/arcs/issues/:cvIssueId/download',
    async (req, reply) => {
      // Any age: a press only follows a page view that filled this cache, and a published
      // issue's number and cover date do not change.
      const issue = findArcIssue(app.db, Number(req.params.cvIssueId))
      if (!issue) return reply.code(404).send({ error: 'issue not in any cached arc' })

      const volumeName = issue.volumeName ?? null
      const existing = issue.volumeId != null ? getEditionByComicvineId(app.db, issue.volumeId) : undefined
      const result = await startIssueDownload(app, {
        volumeName,
        editionName: existing?.name ?? volumeName ?? 'Unsorted',
        issue: { id: issue.id, number: issue.number, coverDate: issue.coverDate },
        label: issueLabel(volumeName, issue.number),
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
