import { searchComicIndex, comicIndexCategories, comicIndexTotal } from '../models/comicIndex.js'
import type { ScrapeMode } from '../services/comicIndexScraper.js'
import type { App } from '../types.js'

const MODES: ScrapeMode[] = ['quick', 'full']

interface ScrapeBody {
  mode?: string
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

export default async function comicIndexRoutes(app: App) {
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
