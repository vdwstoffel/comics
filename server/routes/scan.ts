import { scanLibrary } from '../services/indexer.js'
import { reorganizeLibrary } from '../services/library.js'
import type { App } from '../types.js'

export default async function scanRoutes(app: App) {
  /**
   * Reorganize, scan, reorganize - and the leading reorganize is not optional.
   *
   * A run interrupted between moveBookToEdition's rename and its setBookEdition leaves
   * the file at its target while the row still names the old path. Scan first and the
   * scanner sees a file no row claims and indexes it as a SECOND book; the reorganizer's
   * self-heal then can only fail on book.file_path's UNIQUE constraint, every time,
   * forever - leaving a ghost row pointing at nothing beside a duplicate that carries
   * none of the original's read progress or Comic Vine metadata. Healing first means
   * every file on disk is claimed by the row that owns it before the scanner looks.
   *
   * The trailing reorganize keeps the property that a loose file dropped into the
   * library is indexed AND filed in the same request.
   */
  app.post('/api/scan', async () => {
    const ctx = { db: app.db, config: app.config }
    const heal = await reorganizeLibrary(ctx)
    const { added, total } = await scanLibrary(ctx)
    const file = await reorganizeLibrary(ctx)
    // The two passes move disjoint sets (what the first moved is already at its target
    // for the second), so moves add up. Skips do not: the second pass retries whatever
    // the first skipped, so summing would count one stuck issue twice. The second pass's
    // count is the one that describes the state the request left behind.
    return { added, total, reorganized: heal.moved + file.moved, skipped: file.skipped }
  })
}
