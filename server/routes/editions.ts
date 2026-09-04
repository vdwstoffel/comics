import { createReadStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  listEditions, getEdition, listPublishers, listReadStates, updateEdition,
} from '../models/editions.js'
import type { EditionUpdate } from '../models/editions.js'
import { listBooksByEdition } from '../models/books.js'
import { deriveReadState } from '../models/progress.js'
import { renameEdition, removeEdition } from '../services/library.js'
import { createComicVine } from '../lib/comicvine.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import { cacheVolumeIssues, getCachedVolumeIssues } from '../models/volumeIssues.js'
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

  // An edition whose books were matched before the volume was recorded has no
  // suggestion to show. Walk to the first matched book and resolve its volume once.
  app.post<{ Params: IdParams }>('/api/editions/:id/comicvine-volume', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })

    const matched = listBooksByEdition(app.db, edition.id).find((b) => b.comicvineId)
    if (!matched) return { matched: false }

    const cv = createComicVine({ apiKey: app.config.comicVineApiKey })
    const issue = await cv.getIssue(matched.comicvineId as number)
    if (!issue.volumeId) return { matched: false }
    const volume = await cv.getVolume(issue.volumeId)

    const patch: EditionUpdate = { cvName: volume.name ?? null, cvStartYear: volume.startYear ?? null }
    if (volume.publisher && !edition.publisher) patch.publisher = volume.publisher
    if (!edition.comicvineId) patch.comicvineId = Number(issue.volumeId)
    updateEdition(app.db, edition.id, patch)

    return { matched: true, edition: getEdition(app.db, edition.id) }
  })

  /**
   * The volume's full issue list, each marked owned or missing, so a gap in a run is
   * visible rather than something to work out by hand.
   *
   * Owned is decided by Comic Vine issue id on both sides - never by issue number, which
   * repeats across volumes. Anything of yours the list does not account for comes back as
   * an `extra`: a comic you own must not vanish because Comic Vine has not heard of it.
   * An edition with no volume, or a Comic Vine that will not answer, still reports your
   * books - a missing-issues feature must never stop you reading what you have.
   */
  app.get<{ Params: IdParams; Querystring: { refresh?: string } }>('/api/editions/:id/issues', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })

    const books = listBooksByEdition(app.db, edition.id)
    const extraOf = (b: (typeof books)[number]) => ({ bookId: b.id, number: b.number, title: b.title })

    if (!edition.comicvineId || !app.config.comicVineApiKey) {
      return { volumeId: edition.comicvineId ?? null, issues: [], extras: books.map(extraOf), owned: 0, total: 0 }
    }

    // Serve what we hold unless it has aged out or a refresh was asked for. A running
    // volume gains an issue a month, so a day-old list is close enough to live, and it
    // spares a paged read of a 651-issue volume on every single page view.
    const refresh = req.query?.refresh === '1'
    const fresh = refresh ? undefined : getCachedVolumeIssues(app.db, edition.comicvineId)

    let volumeIssues: CvVolumeIssue[]
    let fetchedAt: string
    let stale = false

    if (fresh) {
      volumeIssues = fresh.issues
      fetchedAt = fresh.fetchedAt
    } else {
      const cv = createComicVine({ apiKey: app.config.comicVineApiKey })
      try {
        volumeIssues = await cv.listVolumeIssues(edition.comicvineId)
        fetchedAt = new Date().toISOString()
        cacheVolumeIssues(app.db, edition.comicvineId, volumeIssues, fetchedAt)
      } catch {
        // A list we already hold beats no list at all, however old it is.
        const anyAge = getCachedVolumeIssues(app.db, edition.comicvineId, Infinity)
        if (!anyAge) {
          return {
            volumeId: edition.comicvineId, issues: [], extras: books.map(extraOf),
            owned: 0, total: 0, unavailable: true,
          }
        }
        volumeIssues = anyAge.issues
        fetchedAt = anyAge.fetchedAt
        stale = true
      }
    }

    const byCvId = new Map(books.filter((b) => b.comicvineId).map((b) => [b.comicvineId as number, b]))
    const issues = volumeIssues.map((issue) => {
      const book = byCvId.get(issue.id)
      return book ? { ...issue, owned: true, bookId: book.id } : { ...issue, owned: false }
    })

    const accounted = new Set(issues.filter((i) => i.owned).map((i) => (i as { bookId: number }).bookId))
    return {
      volumeId: edition.comicvineId,
      issues,
      extras: books.filter((b) => !accounted.has(b.id)).map(extraOf),
      owned: accounted.size,
      total: issues.length,
      fetchedAt,
      ...(stale ? { stale: true } : {}),
    }
  })

  app.delete<{ Params: IdParams }>('/api/editions/:id', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    const { books } = await removeEdition({ db: app.db, config: app.config }, edition.id)
    return { deleted: true, books }
  })
}
