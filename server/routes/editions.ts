import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  listEditions, getEdition, listPublishers, listReadStates, updateEdition,
} from '../models/editions.js'
import { listBooksByEdition } from '../models/books.js'
import { deriveReadState } from '../models/progress.js'
import { renameEdition } from '../services/library.js'
import { editionFilterOf, readStateOf } from './filters.js'
import type { LibraryQuery } from './filters.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface EditEditionBody { name?: string; seriesName?: string }

export default async function editionRoutes(app: App) {
  app.get<{ Querystring: LibraryQuery }>('/api/editions', async (req) => {
    return { editions: listEditions(app.db, editionFilterOf(req.query)) }
  })

  app.get('/api/publishers', async () => ({ publishers: listPublishers(app.db) }))

  app.get('/api/read-states', async () => ({ readStates: listReadStates(app.db) }))

  app.get<{ Params: IdParams; Querystring: LibraryQuery }>('/api/editions/:id', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    const books = listBooksByEdition(app.db, edition.id, readStateOf(req.query.readState))
      .map((b) => deriveReadState(app.db, b))
    return { edition, books }
  })

  app.get<{ Params: IdParams }>('/api/editions/:id/thumbnail', async (req, reply) => {
    const books = listBooksByEdition(app.db, Number(req.params.id))
    if (!books.length) return reply.code(404).send({ error: 'no books' })
    const p = join(app.config.thumbsDir, `${books[0].id}.webp`)
    if (!existsSync(p)) return reply.code(404).send({ error: 'no thumbnail' })
    reply.type('image/webp')
    return createReadStream(p)
  })

  app.patch<{ Params: IdParams; Body: EditEditionBody }>('/api/editions/:id', async (req, reply) => {
    const wantsRename = req.body?.name !== undefined
    const wantsReseries = req.body?.seriesName !== undefined
    if (!wantsRename && !wantsReseries) {
      return reply.code(400).send({ error: 'name or seriesName is required' })
    }

    const name = (req.body?.name ?? '').trim()
    if (wantsRename && !name) return reply.code(400).send({ error: 'name is required' })

    const existing = getEdition(app.db, Number(req.params.id))
    if (!existing) return reply.code(404).send({ error: 'edition not found' })

    // A series change touches one column; a rename also moves files on disk.
    if (wantsReseries) {
      updateEdition(app.db, existing.id, { seriesName: req.body!.seriesName!.trim() || null })
    }
    if (!wantsRename) return { edition: getEdition(app.db, existing.id) }

    const result = await renameEdition({ db: app.db, config: app.config }, existing.id, name)
    return { edition: result.edition }
  })
}
