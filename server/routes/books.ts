import { createReadStream, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getBook, updateBook } from '../models/books.js'
import { getProgress, setProgress, deriveReadState } from '../models/progress.js'
import { getBookCredits, getBookTags } from '../models/metadata.js'
import { readPage } from '../lib/cbz.js'
import { moveBookToEdition } from '../services/library.js'
import { syncComicInfoFile } from '../services/comicinfoSync.js'
import type { App, Book } from '../types.js'

const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function absCbz(app: App, book: Book): string {
  return join(app.config.comicsDir, book.filePath)
}

interface IdParams { id: string }
interface PageParams { id: string; n: string }
interface ProgressBody { lastPage?: number; completed?: boolean }
type MetadataBody = Record<string, unknown>
interface MoveEditionBody { name?: string }
interface ContinueQuery { limit?: string; publisher?: string }


export default async function booksRoutes(app: App) {

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
    // The file carries the metadata too, so a save is not finished until it is written.
    const synced = await syncComicInfoFile({ db: app.db, config: app.config }, book.id)
    return {
      book: synced ?? updatedBook,
      credits: getBookCredits(app.db, book.id),
      tags: getBookTags(app.db, book.id),
    }
  })

  app.put<{ Params: IdParams; Body: MoveEditionBody }>('/api/books/:id/edition', async (req, reply) => {
    const name = (req.body?.name ?? '').trim()
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const result = await moveBookToEdition({ db: app.db, config: app.config }, book.id, name)
    return { book: result.book, edition: result.edition }
  })
}
