import { createComicVine } from '../lib/comicvine.js'
import { listStoryArcs, booksInArc, ownedIssueIds } from '../models/arcs.js'
import { setTagIds } from '../models/metadata.js'
import type { App } from '../types.js'

interface NameParams { name: string }

export default async function arcRoutes(app: App) {
  const cv = createComicVine({ apiKey: app.config.comicVineApiKey })

  // Which arcs the library knows about is a question about the library, so it never
  // touches Comic Vine.
  app.get('/api/arcs', async () => ({ arcs: listStoryArcs(app.db) }))

  app.get<{ Params: NameParams }>('/api/arcs/:name', async (req, reply) => {
    if (!app.config.comicVineApiKey) return reply.code(400).send({ error: 'Comic Vine API key not configured' })
    const name = decodeURIComponent(req.params.name)

    const rows = booksInArc(app.db, name)
    if (rows.length === 0) return reply.code(404).send({ error: 'arc not in this library' })

    let extId = rows.find((r) => r.extId != null)?.extId ?? null

    // No id stored: re-read an issue that carries the tag, the same way a character is
    // backfilled. Two requests the first time this arc is opened, one after that.
    if (extId == null) {
      const source = rows.find((r) => r.comicvineId != null)
      if (source) {
        const issue = await cv.getIssue(source.comicvineId!)
        setTagIds(app.db, source.bookId, 'story_arc', issue.storyArcs)
        extId = issue.storyArcs.find((a) => a.name === name)?.id ?? null
      }
    }
    if (extId == null) return reply.code(404).send({ error: 'arc not found on Comic Vine' })

    const arc = await cv.getStoryArc(extId)
    const owned = ownedIssueIds(app.db)

    return {
      arc: {
        ...arc,
        issues: arc.issues.map((issue) => {
          const bookId = owned.get(issue.id)
          return bookId == null ? { ...issue, owned: false } : { ...issue, owned: true, bookId }
        }),
      },
    }
  })
}
