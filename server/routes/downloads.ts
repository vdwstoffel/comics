import { resolveDownload } from '../services/downloader.js'
import { move, retry, clearHistory } from '../models/downloadQueue.js'
import type { App } from '../types.js'

interface ResolveBody { url?: string }
interface StartBody { url?: string; edition?: string; issueId?: number | string; label?: string }
interface IdParams { id: string }

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

  app.post<{ Body: StartBody }>('/api/downloads', async (req, reply) => {
    const url = req.body?.url?.trim()
    if (!url) return reply.code(400).send({ error: 'missing url' })
    const res = app.downloader.enqueue({
      url,
      edition: req.body?.edition?.trim() || undefined,
      issueId: req.body?.issueId,
      // A pasted link has no issue to name it after; the url stands in until the
      // response says what the file is called.
      label: req.body?.label?.trim() || url,
    })
    if (!res.queued) {
      // `reason` is what a client switches on; the message is for a person to read.
      return reply.code(409).send({ reason: 'duplicate', error: 'that is already queued', entry: res.duplicate })
    }
    return reply.code(202).send({ queued: true, entry: res.entry })
  })

  // Cancel goes through the runner, not the model: a running row needs its fetch aborted,
  // and only the runner holds that controller.
  app.delete<{ Params: IdParams }>('/api/downloads/queue/:id', async (req, reply) => {
    if (!app.downloader.cancel(Number(req.params.id))) {
      return reply.code(404).send({ error: 'not in the queue' })
    }
    return { cancelled: true }
  })

  // The row goes back through the model, so the pool has to be told by hand - nothing
  // was enqueued and nothing would otherwise wake it.
  app.post<{ Params: IdParams }>('/api/downloads/queue/:id/retry', async (req, reply) => {
    if (!retry(app.db, Number(req.params.id))) {
      return reply.code(404).send({ error: 'no failed download with that id' })
    }
    app.downloader.wake()
    return { retried: true }
  })

  app.patch<{ Params: IdParams; Body: { index?: number } }>('/api/downloads/queue/:id', async (req, reply) => {
    const index = req.body?.index
    if (typeof index !== 'number') return reply.code(400).send({ error: 'missing index' })
    if (!move(app.db, Number(req.params.id), index)) {
      return reply.code(400).send({ error: 'cannot move that download there' })
    }
    return { moved: true }
  })

  app.delete('/api/downloads/history', async () => { clearHistory(app.db); return { cleared: true } })
}
