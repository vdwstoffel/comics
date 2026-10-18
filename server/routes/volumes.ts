import { listEditions } from '../models/editions.js'
import { groupIntoShelves } from '../models/shelves.js'
import { listBooksByShelf } from '../models/books.js'
import { deriveReadState } from '../models/progress.js'
import { readStateOf } from './filters.js'
import type { LibraryQuery } from './filters.js'
import type { App } from '../types.js'

interface VolumeParams { volumeId: string }

export default async function volumeRoutes(app: App) {
  /**
   * One volume's shelf: every book of it you own, whatever form it arrived in.
   *
   * Keyed by the Comic Vine volume rather than by an edition, because the whole point is
   * that several editions answer to it. A volume nothing on the shelves keys to is a 404
   * rather than an empty shelf - a bookmark can outlive the editions that made it, and
   * "here is a run holding nothing" is a worse answer than "that is not here".
   */
  app.get<{ Params: VolumeParams; Querystring: LibraryQuery }>(
    '/api/volumes/:volumeId',
    async (req, reply) => {
      const volumeId = Number(req.params.volumeId)
      if (!Number.isFinite(volumeId)) return reply.code(404).send({ error: 'volume not found' })

      // Grouped over the whole library, never the filtered slice: a shelf is what it
      // is regardless of which of its books a read-state filter is showing, and this
      // route is reached from the home shelf's tile with ?status=unread on it. Filtered
      // grouping turned the shelf into whichever collection happened to hold an unread
      // comic, and 404'd a fully-read shelf that plainly exists.
      const shelf = groupIntoShelves(listEditions(app.db))
        .find((s) => s.key === `volume:${volumeId}`)
      if (!shelf) return reply.code(404).send({ error: 'volume not found' })

      const readState = readStateOf(req.query.readState)
      const books = listBooksByShelf(
        app.db,
        shelf.editions.map((e) => e.id),
        readState,
      ).map((b) => deriveReadState(app.db, b))

      // Under a filter the count has to describe what the page is actually showing,
      // the way an edition's does.
      return { shelf: readState ? { ...shelf, bookCount: books.length } : shelf, books }
    },
  )
}
