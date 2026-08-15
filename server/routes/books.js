import { createReadStream, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
import { getBook } from '../models/books.js'
import { getProgress, setProgress } from '../models/progress.js'
import { readPage } from '../lib/cbz.js'

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' }

function absCbz(app, book) {
  return join(app.config.comicsDir, book.filePath)
}

export default async function booksRoutes(app) {
  app.get('/api/books/:id', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    return { book, progress: getProgress(app.db, book.id) }
  })

  app.get('/api/books/:id/pages/:n', async (req, reply) => {
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

  app.get('/api/books/:id/thumbnail', async (req, reply) => {
    const p = join(app.config.thumbsDir, `${Number(req.params.id)}.webp`)
    if (!existsSync(p)) return reply.code(404).send({ error: 'no thumbnail' })
    reply.type('image/webp')
    return createReadStream(p)
  })

  app.put('/api/books/:id/progress', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    const { lastPage = 0, completed = false } = req.body || {}
    return { progress: setProgress(app.db, book.id, { lastPage, completed }) }
  })
}
