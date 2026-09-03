import { createComicVine } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getEdition, updateEdition } from '../models/editions.js'
import { replaceBookCredits, replaceBookTags, getBookCredits, getBookTags, setCharacterTagIds } from '../models/metadata.js'
import { syncComicInfoFile } from '../services/comicinfoSync.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface SearchQuery { q?: string; type?: string }
interface NameQuery { name?: string }

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
    const meta = await cv.getIssue(issueId)

    // Best-effort: fetch publisher from the volume BEFORE opening the transaction
    // (better-sqlite3 transactions must be synchronous; no async calls inside)
    let publisher: string | undefined
    try {
      if (meta.volumeId) publisher = (await cv.getVolume(meta.volumeId)).publisher
    } catch { /* best-effort; don't fail the match */ }

    const updatedBook = app.db.transaction(() => {
      const b = updateBook(app.db, book.id, {
        title: meta.title ?? null, number: meta.number ?? null, date: meta.date ?? null,
        summary: meta.summary ?? null, writer: meta.writer ?? null, penciller: meta.penciller ?? null,
        comicvineId: Number(issueId),
        year: meta.year ?? null, coverUrl: meta.coverUrl ?? null, cvSiteUrl: meta.siteUrl ?? null,
        publisher: publisher ?? null,
      })
      replaceBookCredits(app.db, book.id, meta.credits)
      const tags = [
        ...meta.characters.map((c) => ({ kind: 'character', value: c.name, extId: c.id })),
        ...meta.teams.map((value) => ({ kind: 'team', value })),
        ...meta.storyArcs.map((value) => ({ kind: 'story_arc', value })),
      ]
      replaceBookTags(app.db, book.id, tags)
      // Propagate publisher to the edition if the edition doesn't have one yet
      if (publisher && book.editionId) {
        const edition = getEdition(app.db, book.editionId)
        if (edition && !edition.publisher) {
          updateEdition(app.db, book.editionId, { publisher })
        }
      }
      return b
    })()

    // Everything Comic Vine just gave us goes into the file as well as the database.
    const synced = await syncComicInfoFile({ db: app.db, config: app.config }, book.id)

    const credits = getBookCredits(app.db, book.id)
    const tags = getBookTags(app.db, book.id)
    return { book: synced ?? updatedBook, credits, tags }
  })

  app.post<{ Params: IdParams; Body: { volumeId?: number | string } }>('/api/editions/:id/comicvine', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    const { volumeId } = req.body || {}
    if (!volumeId) return reply.code(400).send({ error: 'missing volumeId' })
    const meta = await cv.getVolume(volumeId)
    return { edition: updateEdition(app.db, edition.id, {
      name: meta.name || edition.name, publisher: meta.publisher ?? null, summary: meta.summary ?? null, comicvineId: Number(volumeId),
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
      setCharacterTagIds(app.db, book.id, issue.characters)
      extId = issue.characters.find((c) => c.name === name)?.id
    }

    if (extId != null) return { character: await cv.getCharacter(extId), verified: true }

    // Unmatched book: the name is all there is to go on, so flag the result as a guess.
    const [match] = await cv.search(name, 'character')
    if (!match?.id) return reply.code(404).send({ error: 'character not found' })
    return { character: await cv.getCharacter(match.id), verified: false }
  })
}
