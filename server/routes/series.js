import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listSeries, getSeries } from '../models/series.js'
import { listBooksBySeries } from '../models/books.js'

export default async function seriesRoutes(app) {
  app.get('/api/series', async () => ({ series: listSeries(app.db) }))

  app.get('/api/series/:id', async (req, reply) => {
    const series = getSeries(app.db, Number(req.params.id))
    if (!series) return reply.code(404).send({ error: 'series not found' })
    return { series, books: listBooksBySeries(app.db, series.id) }
  })

  app.get('/api/series/:id/thumbnail', async (req, reply) => {
    const books = listBooksBySeries(app.db, Number(req.params.id))
    if (!books.length) return reply.code(404).send({ error: 'no books' })
    const p = join(app.config.thumbsDir, `${books[0].id}.webp`)
    if (!existsSync(p)) return reply.code(404).send({ error: 'no thumbnail' })
    reply.type('image/webp')
    return createReadStream(p)
  })
}
