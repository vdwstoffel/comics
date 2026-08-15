import { createComicVine } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getSeries, updateSeries } from '../models/series.js'
import { replaceBookCredits, replaceBookTags, getBookCredits, getBookTags } from '../models/metadata.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface SearchQuery { q?: string; type?: string }

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

    const updatedBook = app.db.transaction(() => {
      const b = updateBook(app.db, book.id, {
        title: meta.title ?? null, number: meta.number ?? null, date: meta.date ?? null,
        summary: meta.summary ?? null, writer: meta.writer ?? null, penciller: meta.penciller ?? null,
        comicvineId: Number(issueId),
        year: meta.year ?? null, coverUrl: meta.coverUrl ?? null, cvSiteUrl: meta.siteUrl ?? null,
      })
      replaceBookCredits(app.db, book.id, meta.credits)
      const tags = [
        ...meta.characters.map((value) => ({ kind: 'character', value })),
        ...meta.teams.map((value) => ({ kind: 'team', value })),
        ...meta.storyArcs.map((value) => ({ kind: 'story_arc', value })),
      ]
      replaceBookTags(app.db, book.id, tags)
      return b
    })()

    const credits = getBookCredits(app.db, book.id)
    const tags = getBookTags(app.db, book.id)
    return { book: updatedBook, credits, tags }
  })

  app.post<{ Params: IdParams; Body: { volumeId?: number | string } }>('/api/series/:id/comicvine', async (req, reply) => {
    const series = getSeries(app.db, Number(req.params.id))
    if (!series) return reply.code(404).send({ error: 'series not found' })
    const { volumeId } = req.body || {}
    if (!volumeId) return reply.code(400).send({ error: 'missing volumeId' })
    const meta = await cv.getVolume(volumeId)
    return { series: updateSeries(app.db, series.id, {
      name: meta.name || series.name, publisher: meta.publisher ?? null, summary: meta.summary ?? null, comicvineId: Number(volumeId),
    }) }
  })
}
