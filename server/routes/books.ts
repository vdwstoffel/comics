import { createReadStream, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getBook, updateBook, listInProgressBooks } from '../models/books.js'
import { getProgress, setProgress, deriveReadState } from '../models/progress.js'
import { getBookCredits, getBookTags } from '../models/metadata.js'
import { readPage } from '../lib/cbz.js'
import { buildComicInfo } from '../lib/comicinfo.js'
import { embedComicInfo } from '../lib/embed.js'
import { getSeries } from '../models/series.js'
import { moveBookToSeries } from '../services/library.js'
import type { App, Book } from '../types.js'

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function absCbz(app: App, book: Book): string {
  return join(app.config.comicsDir, book.filePath)
}

interface IdParams { id: string }
interface PageParams { id: string; n: string }
interface ProgressBody { lastPage?: number; completed?: boolean }
type MetadataBody = Record<string, unknown>
interface MoveSeriesBody { name?: string }
interface ContinueQuery { limit?: string; publisher?: string }

const CONTINUE_READING_LIMIT = 12

export default async function booksRoutes(app: App) {
  app.get<{ Querystring: ContinueQuery }>('/api/continue-reading', async (req) => {
    const requested = Number(req.query.limit)
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, CONTINUE_READING_LIMIT) : CONTINUE_READING_LIMIT
    const books = listInProgressBooks(app.db, limit, req.query.publisher).map((b) => ({
      ...deriveReadState(app.db, b),
      seriesName: getSeries(app.db, b.seriesId)?.name ?? '',
    }))
    return { books }
  })

  app.get<{ Params: IdParams }>('/api/books/:id', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    return {
      book,
      progress: getProgress(app.db, book.id),
      credits: getBookCredits(app.db, book.id),
      tags: getBookTags(app.db, book.id),
    }
  })

  app.get<{ Params: PageParams }>('/api/books/:id/pages/:n', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    try {
      const { stream, entryName } = await readPage(absCbz(app, book), Number(req.params.n))
      reply.type(MIME[extname(entryName).toLowerCase()] || 'application/octet-stream')
      return stream
    } catch {
      return reply.code(404).send({ error: 'page out of range' })
    }
  })

  app.get<{ Params: IdParams }>('/api/books/:id/thumbnail', async (req, reply) => {
    const p = join(app.config.thumbsDir, `${Number(req.params.id)}.webp`)
    if (!existsSync(p)) return reply.code(404).send({ error: 'no thumbnail' })
    reply.type('image/webp')
    return createReadStream(p)
  })

  app.put<{ Params: IdParams; Body: ProgressBody }>('/api/books/:id/progress', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const { lastPage = 0, completed = false } = req.body || {}
    return { progress: setProgress(app.db, book.id, { lastPage, completed }) }
  })

  const EDITABLE = ['title', 'number', 'writer', 'penciller', 'summary', 'date'] as const

  app.patch<{ Params: IdParams; Body: MetadataBody }>('/api/books/:id/metadata', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const body = req.body || {}
    const fields: Record<string, unknown> = {}
    for (const k of EDITABLE) if (k in body) fields[k] = body[k]
    const updatedBook = updateBook(app.db, book.id, fields)
    return { book: updatedBook, credits: getBookCredits(app.db, book.id), tags: getBookTags(app.db, book.id) }
  })

  app.post<{ Params: IdParams }>('/api/books/:id/embed', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const series = getSeries(app.db, book.seriesId)
    const xml = buildComicInfo({
      title: book.title ?? undefined, series: series?.name, number: book.number ?? undefined,
      writer: book.writer ?? undefined, penciller: book.penciller ?? undefined, summary: book.summary ?? undefined,
      publisher: series?.publisher ?? undefined, date: book.date ?? undefined,
    })
    await embedComicInfo(absCbz(app, book), xml)
    const updatedBook = updateBook(app.db, book.id, { comicinfoSynced: true })
    return { book: updatedBook, credits: getBookCredits(app.db, book.id), tags: getBookTags(app.db, book.id) }
  })

  app.put<{ Params: IdParams; Body: MoveSeriesBody }>('/api/books/:id/series', async (req, reply) => {
    const name = (req.body?.name ?? '').trim()
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const result = await moveBookToSeries({ db: app.db, config: app.config }, book.id, name)
    return { book: result.book, series: result.series }
  })
}
