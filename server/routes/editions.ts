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
import { findMatchForIssue } from '../services/issueMatching.js'
import { startIssueDownload, issueLabel } from '../services/issueDownload.js'
import { queueMissingIssues, missingMatchedIssues } from '../services/bulkIssueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { editionFilterOf, readStateOf } from './filters.js'
import type { LibraryQuery } from './filters.js'
import { getComicVineKey } from '../models/settings.js'
import type { App } from '../types.js'

interface IdParams { id: string }
interface EditEditionBody { name?: string; seriesName?: string }

export interface EditionRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
  /** The pause between issues of a "Get all" walk. Injected as 0 by tests. */
  bulkDelayMs?: number
}

export default async function editionRoutes(app: App, opts: EditionRouteOpts = {}) {
  const { fetchPage = fetchSourcePage, bulkDelayMs } = opts
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

    const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })
    const issue = await cv.getIssue(matched.comicvineId as number)
    if (!issue.volumeId) return { matched: false }
    const volume = await cv.getVolume(issue.volumeId)

    const patch: EditionUpdate = {
      cvName: volume.name ?? null,
      cvStartYear: volume.startYear ?? null,
      cvSiteUrl: volume.siteUrl ?? null,
    }
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

    if (!edition.comicvineId || !getComicVineKey(app.db)) {
      return {
        volumeId: edition.comicvineId ?? null, issues: [], extras: books.map(extraOf),
        owned: 0, total: 0, siteUrl: edition.cvSiteUrl ?? null,
      }
    }

    // Comic Vine's own page for this volume, carried on this response because the line
    // that renders it is drawn from this response. An edition matched before the link was
    // recorded resolves it once, here, and is served from its own row forever after: the
    // canonical url carries a slug that cannot be derived from the volume id.
    let siteUrl = edition.cvSiteUrl ?? null
    if (!siteUrl) {
      try {
        const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })
        siteUrl = (await cv.getVolume(edition.comicvineId)).siteUrl ?? null
        if (siteUrl) updateEdition(app.db, edition.id, { cvSiteUrl: siteUrl })
      } catch {
        // A link is the smallest thing on this page. Losing it must not cost the run.
        siteUrl = null
      }
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
      const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })
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
            owned: 0, total: 0, unavailable: true, siteUrl,
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
      if (book) return { ...issue, owned: true, bookId: book.id }
      // Only what you are missing is worth matching; a match for a comic you already
      // have would be computed and thrown away.
      return { ...issue, owned: false, match: findMatchForIssue(app.db, edition.cvName, issue) }
    })

    const accounted = new Set(issues.filter((i) => i.owned).map((i) => (i as { bookId: number }).bookId))
    return {
      volumeId: edition.comicvineId,
      issues,
      extras: books.filter((b) => !accounted.has(b.id)).map(extraOf),
      owned: accounted.size,
      total: issues.length,
      fetchedAt,
      siteUrl,
      ...(stale ? { stale: true } : {}),
    }
  })

  /**
   * Download the one scraped release that is this missing issue, into this edition.
   *
   * The match is decided again here rather than taken from the page. A tile rendered
   * before a scrape could otherwise act on a row that has since moved, so the rule that
   * showed the button is the rule that acts - and a match that has become ambiguous in
   * the interval refuses instead of proceeding.
   *
   * The issue id is carried into the download, which is what makes this the one import
   * path where Comic Vine's identity for a comic is known rather than inferred from a
   * filename. Nothing here may fall back to searching Comic Vine by name: that search
   * cannot tell a dozen relaunches of "Captain America" apart, and a fallback would
   * quietly reintroduce exactly that failure.
   */
  app.post<{ Params: { id: string; cvIssueId: string } }>(
    '/api/editions/:id/issues/:cvIssueId/download',
    async (req, reply) => {
      const edition = getEdition(app.db, Number(req.params.id))
      if (!edition) return reply.code(404).send({ error: 'edition not found' })
      if (!edition.comicvineId) return reply.code(404).send({ error: 'edition has no volume' })

      // Any age: a press only follows a page view that filled this cache, and a
      // published issue's number and cover date do not change.
      const held = getCachedVolumeIssues(app.db, edition.comicvineId, Infinity)
      const issue = held?.issues.find((i) => i.id === Number(req.params.cvIssueId))
      if (!issue) return reply.code(404).send({ error: 'issue not in this volume' })

      const result = await startIssueDownload(app, {
        volumeName: edition.cvName,
        editionName: edition.name,
        issue,
        label: issueLabel(edition.cvName, issue.number),
        fetchPage,
      })
      // `reason` is the machine-readable half of the refusal: a client cannot tell a
      // no-match 409 from a duplicate one by string-matching the message.
      if (!result.ok) {
        return reply.code(result.code).send({ reason: result.reason, error: result.error, entry: result.entry })
      }
      return reply.code(202).send({ queued: true, entry: result.entry })
    },
  )

  /**
   * Fill every gap in this volume that the index can fill, in one press.
   *
   * Which gaps those are is decided here and not by the page: the same rule that drew
   * each tile's Get button, applied again at press time, so a run rescraped between the
   * render and the press cannot turn a button into a download of something else.
   *
   * The answer comes back before the work does. Walking thirty issues means fetching
   * thirty posts from someone else's site, which takes about as long as it sounds; the
   * count is what the button needs to hear, and the rows arriving in the download queue
   * are what shows the rest.
   */
  app.post<{ Params: IdParams }>('/api/editions/:id/issues/download-all', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    if (!edition.comicvineId) return reply.code(404).send({ error: 'edition has no volume' })

    // Any age, for the same reason the single-issue route takes any age: a press only
    // follows a page view that filled this cache.
    const held = getCachedVolumeIssues(app.db, edition.comicvineId, Infinity)
    if (!held) return reply.code(404).send({ error: 'no run held for this volume' })

    const owned = new Set(
      listBooksByEdition(app.db, edition.id)
        .map((b) => b.comicvineId)
        .filter((id): id is number => id != null),
    )
    const issues = missingMatchedIssues(app, { edition, issues: held.issues, owned })

    const result = queueMissingIssues(app, { edition, issues, fetchPage, delayMs: bulkDelayMs })
    if ('already' in result) {
      return reply.code(409).send({ error: 'this volume is already being queued' })
    }
    return reply.code(202).send(result)
  })

  app.delete<{ Params: IdParams }>('/api/editions/:id', async (req, reply) => {
    const edition = getEdition(app.db, Number(req.params.id))
    if (!edition) return reply.code(404).send({ error: 'edition not found' })
    const { books } = await removeEdition({ db: app.db, config: app.config }, edition.id)
    return { deleted: true, books }
  })
}
