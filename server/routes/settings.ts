import { createComicVine } from '../lib/comicvine.js'
import {
  getDownloadConcurrency, setDownloadConcurrency,
  getComicVineKey, setComicVineKey,
} from '../models/settings.js'
import type { App } from '../types.js'

interface PatchBody {
  downloadConcurrency?: unknown
  comicVineApiKey?: unknown
}

export default async function settingsRoutes(app: App) {
  const view = () => ({
    downloadConcurrency: getDownloadConcurrency(app.db),
    comicVineApiKey: getComicVineKey(app.db),
  })

  app.get('/api/settings', async () => view())

  app.patch<{ Body: PatchBody }>('/api/settings', async (req, reply) => {
    const body = req.body ?? {}
    // A body that isn't an object at all - a bare number, string or boolean - has no
    // fields to speak of, and the `in` operator throws on anything else. Guarding here
    // means such a body is refused the same way an empty object is, rather than leaking
    // an internal exception.
    const isObject = typeof body === 'object'
    const hasConcurrency = isObject && 'downloadConcurrency' in body
    const hasKey = isObject && 'comicVineApiKey' in body

    // An absent field is left alone, so one control can save without knowing about the
    // others. A body naming neither is still refused: a misspelled field would otherwise
    // return 200 having done nothing.
    if (!hasConcurrency && !hasKey) {
      return reply.code(400).send({ error: 'nothing to update' })
    }

    // The cheap local write first. The key check is a network round trip, and a valid
    // number should not go unapplied because a third party was unreachable; the two
    // settings have nothing to do with each other.
    if (hasConcurrency) {
      const value = body.downloadConcurrency
      if (typeof value !== 'number') {
        return reply.code(400).send({ error: 'downloadConcurrency must be a number' })
      }
      // The model owns the range. The route does not repeat it, or the two would drift.
      if (!setDownloadConcurrency(app.db, value)) {
        return reply.code(400).send({ error: 'downloadConcurrency must be a whole number from 1 to 5' })
      }
      // A busy pool is woken by nothing else, so without this a raise would do nothing
      // visible until the download in progress happened to end. Only a concurrency change
      // wakes it - saving a key has nothing to do with the queue.
      app.downloader.wake()
    }

    if (hasKey) {
      const value = body.comicVineApiKey
      if (typeof value !== 'string') {
        return reply.code(400).send({ error: 'comicVineApiKey must be a string' })
      }
      const key = value.trim()
      // Clearing is not a key to check, and refusing to clear would leave no way back to
      // an unconfigured install.
      if (key) {
        try {
          // A throwaway client, on purpose: it starts with lastCall = 0, so it never waits
          // out the 1-request-per-second throttle the shared closures normally enforce.
          // Saving is human-paced - nobody clicks Save fast enough to make that matter -
          // so a per-request client here is fine; it is only ever asked to make one call.
          await createComicVine({ apiKey: key }).verifyKey()
        } catch (err) {
          // Comic Vine's own wording, carried through: a rejected key and an unreachable
          // Comic Vine look the same from here, and this message is the only thing that
          // tells them apart.
          return reply.code(400).send({
            error: `Comic Vine did not accept that key: ${(err as Error).message}`,
          })
        }
      }
      setComicVineKey(app.db, key)
    }

    return view()
  })
}
