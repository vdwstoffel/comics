import { createComicVine, CvApiError } from '../lib/comicvine.js'
import { applyIssueToBook } from '../services/applyIssue.js'
import type { CvVolume } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getEdition, updateEdition } from '../models/editions.js'
import type { EditionUpdate } from '../models/editions.js'
import { replaceBookCredits, replaceBookTags, getBookCredits, getBookTags, setTagIds } from '../models/metadata.js'
import { cacheVolumeSearch, getCachedVolumeSearch } from '../models/volumeSearch.js'
import { syncComicInfoFile } from '../services/comicinfoSync.js'
import { listMetadataFollowups, dismissFollowup, restoreFollowup } from '../models/metadataFollowups.js'
import { getComicVineKey } from '../models/settings.js'
import type { App } from '../types.js'

/**
 * Was this failure Comic Vine's, rather than ours?
 *
 * Two shapes reach here. A CvApiError is an answer we did get and could not use: an HTTP
 * 5xx, a rate limit, a rejected key - the client wraps all of them. A connection that
 * never completed is different: node's fetch throws TypeError('fetch failed') with the
 * socket error on `cause`, and there was no response to wrap, so it arrives raw. Both are
 * "Comic Vine, not Comix". Anything else - a database error, a bug in the apply - is ours
 * and must keep its 500, or an outage message would start covering for real faults.
 */
function cvUnreachable(err: unknown): boolean {
  if (err instanceof CvApiError) return true
  return err instanceof TypeError && /fetch failed/i.test(err.message)
}

interface IdParams { id: string }
interface SearchQuery { q?: string; type?: string }
interface NameQuery { name?: string }
interface SeriesQuery { series?: string }

export default async function comicvineRoutes(app: App) {
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  app.get<{ Querystring: SearchQuery }>('/api/comicvine/search', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const { q, type = 'issue' } = req.query
    if (!q) return reply.code(400).send({ error: 'missing q' })
    return { results: await cv.search(q, type) }
  })

  /**
   * Bind a book to a Comic Vine issue and apply what it says.
   *
   * `manual` means the id was TYPED by the user, and only the manual-entry input sends it.
   * Refresh and search-and-pick go through this same route without it: a refresh must not
   * re-stamp an entry's created_at, and an id Comic Vine itself offered is not something
   * to be reminded about later.
   */
  app.post<{ Params: IdParams; Body: { issueId?: unknown; manual?: unknown } }>('/api/books/:id/comicvine', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const { issueId: raw, manual } = req.body || {}
    if (raw == null || raw === '') return reply.code(400).send({ error: 'missing issueId' })
    // The page is not this route's only caller and its parser is a convenience, not a
    // boundary. Digits only, no leading zero: Number('1e3') or Number('0x10') would
    // otherwise sail through and bind a different id than the one that was typed.
    const issueId = typeof raw === 'number' ? raw : typeof raw === 'string' && /^[1-9]\d*$/.test(raw) ? Number(raw) : NaN
    if (!Number.isSafeInteger(issueId) || issueId <= 0) {
      return reply.code(400).send({ error: 'issueId must be a positive integer' })
    }
    try {
      const applied = await applyIssueToBook({ db: app.db, config: app.config }, book.id, issueId, { manual: manual === true })
      // Typing an id by hand is the user saying "this comic is bound to a record I expect
      // Comic Vine to fill in later" - which is precisely what the follow-up list is for.
      // So it undoes an earlier dismissal: a note the user asked for again should come
      // back, while nothing automatic is allowed to resurrect one. After the apply, so a
      // rejected id raises nothing from the dead.
      if (manual === true) restoreFollowup(app.db, book.id)
      return applied
    } catch (err) {
      // Comic Vine's "Object Not Found" arrives as HTTP 200 with status_code 101, and the
      // service has written nothing by the time it throws. It is the user's typo, not a
      // server fault, so it is a 404 the page can say in words.
      if (err instanceof CvApiError && err.cvStatus === 101) {
        return reply.code(404).send({ error: 'Comic Vine has no issue with that id.' })
      }
      // Every other Comic Vine failure used to fall through to Fastify's default handler,
      // which answers {"error":"Internal Server Error"} - and the page printed that, so a
      // Comic Vine outage read as a bug in Comix. That is the worst possible message for
      // this feature: an outage is exactly when the follow-up list is used, and the user
      // already half-believes the whole API is down when in fact only issue SEARCH is
      // failing and direct lookups answer fine. 502 says which end failed, and the detail
      // says what Comic Vine actually did.
      if (cvUnreachable(err)) {
        const detail = err instanceof CvApiError ? err.message.replace(/^Comic Vine /, '') : 'no answer'
        return reply.code(502).send({
          error: `Comic Vine could not be read, so nothing was changed (${detail}).`,
        })
      }
      // Not Comic Vine: a real fault here, kept as the 500 it has always been rather than
      // blamed on an upstream that answered perfectly well.
      throw err
    }
  })

  // Comics whose metadata is incomplete, whatever matched them: no cover date, no summary
  // or no credits. Derived from the books, so a thin record matched from search counts
  // exactly as a hand-typed one does - the point of the list is the hole, not the route in.
  app.get('/api/metadata-followups', async () => ({ followups: listMetadataFollowups(app.db) }))

  // Dismissal is the user saying they are done with a note. It writes one row in its own
  // table and touches nothing else: the comic keeps its Comic Vine id, its metadata, its
  // file and its hand-typed provenance.
  app.delete<{ Params: { bookId: string } }>('/api/metadata-followups/:bookId', async (req) => {
    dismissFollowup(app.db, Number(req.params.bookId))
    return { dismissed: true }
  })

  // What a matched issue implies about where the comic belongs, so the upload screen can
  // show the edition before the file is sent. The issue's own year is its cover date; the
  // edition needs the volume's START year - Venom #256 is a 2026 issue of the 2025 volume.
  app.get<{ Params: IdParams }>('/api/comicvine/issues/:id/volume', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const issue = await cv.getIssue(req.params.id)
    if (!issue.volumeId) return { volume: null }
    const volume = await cv.getVolume(issue.volumeId)
    return {
      volume: {
        id: Number(issue.volumeId),
        name: volume.name ?? null,
        startYear: volume.startYear ?? null,
        publisher: volume.publisher ?? null,
        // The name this comic's edition should carry, composed here so one place decides it.
        editionName: volume.name && volume.startYear ? `${volume.name} (${volume.startYear})` : null,
      },
    }
  })

  /**
   * Which Comic Vine volumes a series name could mean, for the search page to link out to.
   *
   * The candidates are offered rather than resolved. A scraped heading and a Comic Vine
   * volume cannot be matched reliably — "The Mighty Thor" is six volumes, the right one
   * ranks third, its start year is a year off the run's first cover date, and its #1-23
   * and #700-706 runs are the same volume under Marvel's legacy renumbering. So the reader
   * picks, and Comic Vine's own relevance order is left exactly as it came.
   *
   * Answers are cached for a day. One search can list two dozen series and Comic Vine
   * allows 200 requests an hour, so a heading opened twice must not cost two of them.
   */
  app.get<{ Querystring: SeriesQuery }>('/api/comicvine/volumes', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const series = req.query.series?.trim()
    if (!series) return reply.code(400).send({ error: 'missing series' })

    const fresh = getCachedVolumeSearch(app.db, series)
    if (fresh) return { volumes: fresh.volumes, fetchedAt: fresh.fetchedAt, stale: false }

    try {
      const volumes = await cv.searchVolumes(series)
      cacheVolumeSearch(app.db, series, volumes)
      return { volumes, fetchedAt: getCachedVolumeSearch(app.db, series)?.fetchedAt ?? null, stale: false }
    } catch (err) {
      // Whatever we already hold beats nothing at all — the links in it still work, they
      // are just however old the stamp says. Only a series we have never looked up has
      // nothing to fall back on.
      const held = getCachedVolumeSearch(app.db, series, Infinity)
      if (held) return { volumes: held.volumes, fetchedAt: held.fetchedAt, stale: true }
      app.log.warn({ err, series }, 'Comic Vine volume lookup failed')
      return reply.code(502).send({ error: 'Comic Vine did not answer' })
    }
  })

  app.post<{ Params: IdParams; Body: { volumeId?: number | string } }>('/api/editions/:id/comicvine', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    const { volumeId } = req.body || {}
    if (!volumeId) return reply.code(400).send({ error: 'missing volumeId' })
    const meta = await cv.getVolume(volumeId)
    return { edition: updateEdition(app.db, edition.id, {
      name: meta.name || edition.name, publisher: meta.publisher ?? null, summary: meta.summary ?? null,
      comicvineId: Number(volumeId), cvSiteUrl: meta.siteUrl ?? null,
    }) }
  })

  /**
   * Who is this character? Answered live, one request per click.
   *
   * The name alone is not enough to identify a character — Comic Vine has four Hobgoblins,
   * and its search ranks by relevance over description text, so asking it for "Hobgoblin"
   * returns Deadpool third. The issue's own credits carry the exact id, so we resolve
   * through those wherever we can and only fall back to searching when there is no match
   * to read them from.
   */
  app.get<{ Params: IdParams; Querystring: NameQuery }>('/api/books/:id/character', async (req, reply) => {
    if (!getComicVineKey(app.db)) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const { name } = req.query
    if (!name) return reply.code(400).send({ error: 'missing name' })

    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })

    const tag = getBookTags(app.db, book.id).find((t) => t.kind === 'character' && t.value === name)
    if (!tag) return reply.code(404).send({ error: 'character not on this book' })

    let extId = tag.extId

    // Tag saved before ids were captured, or read out of a ComicInfo.xml during a scan.
    // Re-read the issue and fill in every character's id at once, so this costs two
    // requests the first time you open any character on this issue and one after that.
    if (extId == null && book.comicvineId) {
      const issue = await cv.getIssue(book.comicvineId)
      setTagIds(app.db, book.id, 'character', issue.characters)
      extId = issue.characters.find((c) => c.name === name)?.id
    }

    if (extId != null) return { character: await cv.getCharacter(extId), verified: true }

    // Unmatched book: the name is all there is to go on, so flag the result as a guess.
    const [match] = await cv.search(name, 'character')
    if (!match?.id) return reply.code(404).send({ error: 'character not found' })
    return { character: await cv.getCharacter(match.id), verified: false }
  })
}
