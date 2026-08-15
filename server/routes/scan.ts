import { scanLibrary } from '../services/indexer.js'
import type { App } from '../types.js'

export default async function scanRoutes(app: App) {
  app.post('/api/scan', async () => {
    return scanLibrary({ db: app.db, config: app.config })
  })
}
