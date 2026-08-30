import { listSeries, getSeries } from '../models/series.js'
import { editionFilterOf } from './filters.js'
import type { LibraryQuery } from './filters.js'
import type { App } from '../types.js'

interface NameParams { name: string }

export default async function seriesRoutes(app: App) {
  app.get<{ Querystring: LibraryQuery }>('/api/series', async (req) => {
    return { series: listSeries(app.db, editionFilterOf(req.query)) }
  })

  app.get<{ Params: NameParams; Querystring: LibraryQuery }>(
    '/api/series/:name',
    async (req, reply) => {
      const series = getSeries(app.db, req.params.name, editionFilterOf(req.query))
      if (!series) return reply.code(404).send({ error: 'series not found' })
      return { series }
    },
  )
}
