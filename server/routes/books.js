import { getBook } from '../models/books.js'
import { getProgress } from '../models/progress.js'

export default async function booksRoutes(app) {
  app.get('/api/books/:id', async (req, reply) => {
    const book = getBook(app.db, Number(req.params.id))
    if (!book) return reply.code(404).send({ error: 'book not found' })
    return { book, progress: getProgress(app.db, book.id) }
  })
}
