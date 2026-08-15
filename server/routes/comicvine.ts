import { createComicVine } from '../lib/comicvine.js'
import { getBook, updateBook } from '../models/books.js'
import { getSeries, updateSeries } from '../models/series.js'
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
    return { book: updateBook(app.db, book.id, {
      title: meta.title ?? null, number: meta.number ?? null, date: meta.date ?? null,
      summary: meta.summary ?? null, writer: meta.writer ?? null, penciller: meta.penciller ?? null,
      comicvineId: Number(issueId),
    }) }
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
