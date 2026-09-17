import { getDownloadConcurrency, setDownloadConcurrency } from '../models/settings.js'
import type { App } from '../types.js'

interface PatchBody { downloadConcurrency?: unknown }

export default async function settingsRoutes(app: App) {
  app.get('/api/settings', async () => ({
    downloadConcurrency: getDownloadConcurrency(app.db),
  }))

  app.patch<{ Body: PatchBody }>('/api/settings', async (req, reply) => {
    const value = req.body?.downloadConcurrency
    if (typeof value !== 'number') {
      return reply.code(400).send({ error: 'downloadConcurrency must be a number' })
    }
    // The model owns the range. The route does not repeat it, or the two would drift.
    if (!setDownloadConcurrency(app.db, value)) {
      return reply.code(400).send({ error: 'downloadConcurrency must be a whole number from 1 to 5' })
    }
    // A busy pool is woken by nothing else, so without this a raise would do nothing
    // visible until the download in progress happened to end.
    app.downloader.wake()
    return { downloadConcurrency: getDownloadConcurrency(app.db) }
  })
}
