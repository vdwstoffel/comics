import { planReorganize, reorganizeLibrary } from '../services/library.js'
import { planRenames, renameLibraryFiles } from '../services/renameFiles.js'
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

  // A one-off tidy-up for files that predate uploads naming themselves. Deliberately NOT
  // wired into scan the way reorganize is: moving a file between folders leaves its name
  // intact, but a rename rewrites the one handle you have on it from outside the app.
  app.post<{ Body: ReorganizeBody }>('/api/library/rename-files', async (req) => {
    const planned = planRenames(app.db)
    if (req.body?.dryRun !== false) return { dryRun: true, planned }
    const { renamed, skipped } = await renameLibraryFiles({ db: app.db, config: app.config })
    return { dryRun: false, planned, renamed, skipped }
  })
}
