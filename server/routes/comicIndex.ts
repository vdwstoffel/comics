import {
  searchComicIndex, comicIndexCategories, comicIndexTotal, comicIndexById,
} from '../models/comicIndex.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import type { ScrapeMode } from '../services/comicIndexScraper.js'
import type { App } from '../types.js'

const MODES: ScrapeMode[] = ['quick', 'full']

interface ScrapeBody {
  mode?: string
}

export interface ComicIndexRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

interface SearchQuery {
  q?: string
  category?: string
  yearFrom?: string
  yearTo?: string
  limit?: string
  offset?: string
}

// Query params arrive as strings; fall back to the model default when they are junk.
function num(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

// An absent or unparseable year means "no bound", not year zero.
function year(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const n = Number(value)
  return Number.isInteger(n) ? n : undefined
}

export default async function comicIndexRoutes(app: App, opts: ComicIndexRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts

  // The link behind a post's "DOWNLOAD NOW" button, read on demand rather than stored:
  // the search page hands this straight to the upload page.
  //
  // Taking a row id rather than a url is what keeps this from being an open proxy — the
  // only pages it can ever fetch are ones the scraper itself put in the index.
  app.get<{ Params: { id: string } }>('/api/comic-index/:id/download-link', async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'id must be a number' })

    const row = comicIndexById(app.db, id)
    if (!row) return reply.code(404).send({ error: 'not found' })

    let html: string
    try {
      html = await fetchPage(row.url)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      return reply.code(502).send({ error: `could not read that post: ${why}` })
    }

    // A post that only offers third-party mirrors has nothing this app can download.
    const url = parseDownloadLink(html, row.url)
    if (!url) return reply.code(404).send({ error: 'that post has no direct download link' })
    return { url }
  })

  app.get<{ Querystring: SearchQuery }>('/api/comic-index/search', async (req) => {
    const { q = '', category, yearFrom, yearTo, limit, offset } = req.query
    return searchComicIndex(app.db, {
      q,
      category: category?.trim() || undefined,
      yearFrom: year(yearFrom),
      yearTo: year(yearTo),
      limit: num(limit, 50),
      offset: num(offset, 0),
    })
  })

  app.get('/api/comic-index/categories', async () => ({
    categories: comicIndexCategories(app.db),
    indexed: comicIndexTotal(app.db),
  }))

  app.get('/api/comic-index/scrape', async () => app.scraper.status())

  // Returns as soon as the run is accepted; the client polls GET for progress.
  app.post<{ Body: ScrapeBody }>('/api/comic-index/scrape', async (req, reply) => {
    const mode = (req.body?.mode ?? 'quick') as ScrapeMode
    if (!MODES.includes(mode)) {
      return reply.code(400).send({ error: `mode must be one of ${MODES.join(', ')}` })
    }
    const { started, status } = app.scraper.start(mode)
    if (!started) return reply.code(409).send({ started, status })
    return reply.code(202).send({ started, status })
  })
}
