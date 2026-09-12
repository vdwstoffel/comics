import { createComicVine } from '../lib/comicvine.js'
import { applyIssueToBook } from '../services/applyIssue.js'
import type { CvVolume } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getEdition, updateEdition } from '../models/editions.js'
import type { EditionUpdate } from '../models/editions.js'
import { replaceBookCredits, replaceBookTags, getBookCredits, getBookTags, setTagIds } from '../models/metadata.js'
import { cacheVolumeSearch, getCachedVolumeSearch } from '../models/volumeSearch.js'
import { syncComicInfoFile } from '../services/comicinfoSync.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface SearchQuery { q?: string; type?: string }
interface NameQuery { name?: string }
interface SeriesQuery { series?: string }

export default async function comicvineRoutes(app: App) {
  const cv = createComicVine({ apiKey: app.config.comicVineApiKey })

  app.get<{ Querystring: SearchQuery }>('/api/comicvine/search', async (req, reply) => {
    if (!app.config.comicVineApiKey) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const { q, type = 'issue' } = req.query
    if (!q) return reply.code(400).send({ error: 'missing q' })
    return { results: await cv.search(q, type) }
  })

  app.post<{ Params: IdParams; Body: { issueId?: number | string } }>('/api/books/:id/comicvine', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const { issueId } = req.body || {}
    if (!issueId) return reply.code(400).send({ error: 'missing issueId' })
    return applyIssueToBook({ db: app.db, config: app.config }, book.id, issueId)
  })

  // What a matched issue implies about where the comic belongs, so the upload screen can
  // show the edition before the file is sent. The issue's own year is its cover date; the
  // edition needs the volume's START year - Venom #256 is a 2026 issue of the 2025 volume.
  app.get<{ Params: IdParams }>('/api/comicvine/issues/:id/volume', async (req, reply) => {
    if (!app.config.comicVineApiKey) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
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
    if (!app.config.comicVineApiKey) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
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
    if (!app.config.comicVineApiKey) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
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
