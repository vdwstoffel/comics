import { createComicVine } from '../lib/comicvine.js'
import type { ComicVineClient, CvStoryArc } from '../lib/comicvine.js'
import { listStoryArcs, booksInArc, ownedIssueIds } from '../models/arcs.js'
import { cacheArc, getCachedArc } from '../models/arcCache.js'
import { setTagIds, getBookTags } from '../models/metadata.js'
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

export default async function arcRoutes(app: App) {
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  // Which arcs the library knows about is a question about the library, so it never
  // touches Comic Vine.
  app.get('/api/arcs', async () => ({ arcs: listStoryArcs(app.db) }))

  app.get<{ Params: NameParams; Querystring: RefreshQuery }>('/api/arcs/:name', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const name = decodeURIComponent(req.params.name)

    const rows = booksInArc(app.db, name)
    if (rows.length === 0) return reply.code(404).send({ error: 'arc not in this library' })

    let extId = rows.find((r) => r.extId != null)?.extId ?? null

    // No id stored: re-read an issue that carries the tag, the same way a character is
    // backfilled. Two requests the first time this arc is opened, none after that.
    if (extId == null) {
      const source = rows.find((r) => r.comicvineId != null)
      if (source) {
        const issue = await cv.getIssue(source.comicvineId!)
        setTagIds(app.db, source.bookId, 'story_arc', issue.storyArcs)
        extId = issue.storyArcs.find((a) => a.name === name)?.id ?? null
      }
    }
    if (extId == null) return reply.code(404).send({ error: 'arc not found on Comic Vine' })

    const loaded = await loadArc(app.db, cv, extId, req.query?.refresh === '1')
    if (!loaded) return reply.code(502).send({ error: 'Comic Vine would not answer for this arc' })

    const owned = ownedIssueIds(app.db)

    return {
      stale: loaded.stale,
      fetchedAt: loaded.fetchedAt,
      arc: {
        ...loaded.arc,
        // An issue you own carries its read state, so the arc draws the same badges the
        // edition grid does. One you do not own has no read state to report.
        issues: loaded.arc.issues.map((issue) => {
          const bookId = owned.get(issue.id)
          if (bookId == null) return { ...issue, owned: false }
          const book = getBook(app.db, bookId)
          if (!book) return { ...issue, owned: true, bookId }
          const { readState, percent } = deriveReadState(app.db, book)
          return { ...issue, owned: true, bookId, readState, percent }
        }),
      },
    }
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
}
