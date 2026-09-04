import { planReorganize, reorganizeLibrary } from '../services/library.js'
import type { App } from '../types.js'

interface ReorganizeBody { dryRun?: boolean }

export default async function libraryRoutes(app: App) {
  // Restructuring moves real files, so a dry run is the default posture: the caller
  // sees the whole plan before anything happens. Only dryRun:false executes.
  app.post<{ Body: ReorganizeBody }>('/api/library/reorganize', async (req) => {
    const planned = planReorganize(app.db)
    if (req.body?.dryRun !== false) return { dryRun: true, planned }
    const { moved, skipped } = await reorganizeLibrary({ db: app.db, config: app.config })
    return { dryRun: false, planned, moved, skipped }
  })
}
