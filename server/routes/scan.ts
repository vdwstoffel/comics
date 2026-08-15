import { scanLibrary } from '../services/indexer.js'
import { reorganizeLibrary } from '../services/library.js'
import type { App } from '../types.js'

export default async function scanRoutes(app: App) {
  app.post('/api/scan', async () => {
    const { added, total } = await scanLibrary({ db: app.db, config: app.config })
    const { moved: reorganized } = await reorganizeLibrary({ db: app.db, config: app.config })
    return { added, total, reorganized }
  })
}
