import { createReadStream, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getBook, updateBook } from '../models/books.js'
import { getProgress, setProgress } from '../models/progress.js'
import { readPage } from '../lib/cbz.js'
import { buildComicInfo } from '../lib/comicinfo.js'
import { embedComicInfo } from '../lib/embed.js'
import { getSeries } from '../models/series.js'
import type { App, Book } from '../types.js'

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function absCbz(app: App, book: Book): string {
  return join(app.config.comicsDir, book.filePath)
}

interface IdParams { id: string }
interface PageParams { id: string; n: string }
interface ProgressBody { lastPage?: number; completed?: boolean }
type MetadataBody = Record<string, unknown>

export default async function booksRoutes(app: App) {
  app.get<{ Params: IdParams }>('/api/books/:id', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    return { book, progress: getProgress(app.db, book.id) }
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
    return { book: updateBook(app.db, book.id, fields) }
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
    return { book: updateBook(app.db, book.id, { comicinfoSynced: true }) }
  })
}
