import { createStorage } from '../services/storage.js'
import type { App } from '../types.js'

/**
 * What the server has room for, for the top of the downloads pane.
 *
 * The cache belongs to the registration rather than the module, so each app built in a
 * test starts with an empty one and nothing it measures leaks into the next.
 */
export default async function storageRoutes(app: App) {
  const storage = createStorage(app.config)

  app.get('/api/storage', async () => storage.read())
}
