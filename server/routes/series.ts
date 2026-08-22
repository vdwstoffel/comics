import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listSeries, getSeries, listPublishers, updateSeries } from '../models/series.js'
import { listSeriesGroups, getSeriesGroup } from '../models/seriesGroups.js'
import { listBooksBySeries } from '../models/books.js'
import { deriveReadState } from '../models/progress.js'
import { renameSeries } from '../services/library.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface RenameBody { name?: string; groupName?: string }
interface SeriesQuery { publisher?: string }
interface GroupParams { name: string }

export default async function seriesRoutes(app: App) {
  app.get<{ Querystring: SeriesQuery }>('/api/series', async (req) => {
    const { publisher } = req.query
    return { series: listSeries(app.db, publisher ? { publisher } : undefined) }
  })

  app.get('/api/publishers', async () => ({ publishers: listPublishers(app.db) }))

  app.get<{ Querystring: SeriesQuery }>('/api/series-groups', async (req) => {
    const { publisher } = req.query
    return { groups: listSeriesGroups(app.db, publisher ? { publisher } : undefined) }
  })

  app.get<{ Params: GroupParams; Querystring: SeriesQuery }>(
    '/api/series-groups/:name',
    async (req, reply) => {
      const { publisher } = req.query
      const group = getSeriesGroup(app.db, req.params.name, publisher ? { publisher } : undefined)
      if (!group) return reply.code(404).send({ error: 'group not found' })
      return { group }
    },
  )

  app.get<{ Params: IdParams }>('/api/series/:id', async (req, reply) => {
    const series = getSeries(app.db, Number(req.params.id))
    if (!series) return reply.code(404).send({ error: 'series not found' })
    const books = listBooksBySeries(app.db, series.id).map((b) => deriveReadState(app.db, b))
    return { series, books }
  })

  app.get<{ Params: IdParams }>('/api/series/:id/thumbnail', async (req, reply) => {
    const books = listBooksBySeries(app.db, Number(req.params.id))
    if (!books.length) return reply.code(404).send({ error: 'no books' })
    const p = join(app.config.thumbsDir, `${books[0].id}.webp`)
    if (!existsSync(p)) return reply.code(404).send({ error: 'no thumbnail' })
    reply.type('image/webp')
    return createReadStream(p)
  })

  app.patch<{ Params: IdParams; Body: RenameBody }>('/api/series/:id', async (req, reply) => {
    const wantsRename = req.body?.name !== undefined
    const wantsRegroup = req.body?.groupName !== undefined
    if (!wantsRename && !wantsRegroup) {
      return reply.code(400).send({ error: 'name or groupName is required' })
    }

    const name = (req.body?.name ?? '').trim()
    if (wantsRename && !name) return reply.code(400).send({ error: 'name is required' })

    const existing = getSeries(app.db, Number(req.params.id))
    if (!existing) return reply.code(404).send({ error: 'series not found' })

    // A group change touches one column; a rename also moves files on disk.
    if (wantsRegroup) {
      updateSeries(app.db, existing.id, { groupName: req.body!.groupName!.trim() || null })
    }
    if (!wantsRename) return { series: getSeries(app.db, existing.id) }

    const result = await renameSeries({ db: app.db, config: app.config }, existing.id, name)
    return { series: result.series }
  })
}
