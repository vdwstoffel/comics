import { resolveDownload } from '../services/downloader.js'
import type { App } from '../types.js'

interface ResolveBody { url?: string }
interface StartBody { url?: string; edition?: string; issueId?: number | string }

export default async function downloadRoutes(app: App) {
  // What a link points at, without fetching the comic itself. The page needs the name
  // before the download starts: it is what the Comic Vine search is built from, and
  // knowing it up front is what lets the file land correctly named.
  app.post<{ Body: ResolveBody }>('/api/downloads/resolve', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })
    try {
      return await resolveDownload(url)
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'could not resolve url' })
    }
  })

  app.get('/api/downloads', async () => app.downloader.status())

  // Returns as soon as the run is accepted; the client polls GET for progress.
  app.post<{ Body: StartBody }>('/api/downloads', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })
    const { started, status } = app.downloader.start({
      url, edition: req.body?.edition?.trim() || undefined, issueId: req.body?.issueId,
    })
    if (!started) return reply.code(409).send({ started, status })
    return reply.code(202).send({ started, status })
  })
}
