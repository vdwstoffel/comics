import { scanLibrary } from '../services/indexer.js'

export default async function scanRoutes(app) {
  app.post('/api/scan', async () => {
    return scanLibrary({ db: app.db, config: app.config })
  })
}
