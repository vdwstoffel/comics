import { rename } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { comicFileName } from '../lib/comicFileName.js'
import { dedupeDestPath } from '../lib/paths.js'
import { renameLock } from '../lib/mutex.js'
import { listEditions } from '../models/editions.js'
import { listBooksByEdition, setBookEdition } from '../models/books.js'
import type { Ctx, Db, Book } from '../types.js'

export interface RenamePlan {
  bookId: number
  from: string
  to: string
}

/** The issue title, as a filename fragment, or nothing when Comic Vine gave none. */
function titlePart(book: Book): string | null {
  const title = book.title?.trim()
  if (!title) return null
  const slug = title.toLowerCase().replace(/[^a-z0-9.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.-]+|[_.-]+$/g, '')
  return slug || null
}

/**
 * What the library's files should be called: `<series>_<number>.cbz`, built from the
 * Comic Vine volume name the edition already carries. Nothing here reaches Comic Vine —
 * every part is data we hold.
 *
 * A book is left alone unless its edition knows its volume and the book knows its issue
 * number. Renaming on a guess loses track of what a file is.
 *
 * Two comics can genuinely share an issue number in one volume — the library holds two
 * different Death Spiral one-shots, both #1. Where that happens, a book with an issue
 * title takes it into the name to stay distinct, and a book without one keeps the name it
 * has, because its old name is the only thing left that tells it apart. Neither ever gets
 * a bare "(2)", which would say nothing about which comic it is.
 */
export function planRenames(db: Db): RenamePlan[] {
  const plans: RenamePlan[] = []

  for (const edition of listEditions(db)) {
    if (!edition.cvName) continue
    const books = listBooksByEdition(db, edition.id)

    // Group first: a name is only a collision in the light of every other book here.
    const wanted = new Map<string, Array<{ book: Book; base: string }>>()
    for (const book of books) {
      const base = comicFileName(edition.cvName, book.number, extname(book.filePath))
      if (!base) continue
      const group = wanted.get(base) ?? []
      group.push({ book, base })
      wanted.set(base, group)
    }

    for (const [base, group] of wanted) {
      for (const { book } of group) {
        let target = base
        if (group.length > 1) {
          const part = titlePart(book)
          // No title, no way to tell it apart: its current name has to stand.
          if (!part) continue
          target = base.replace(/(\.[^.]+)$/, `_${part}$1`)
        }
        const to = `${dirname(book.filePath)}/${target}`
        if (to !== book.filePath) plans.push({ bookId: book.id, from: book.filePath, to })
      }
    }
  }

  return plans.sort((a, b) => a.bookId - b.bookId)
}

/**
 * Rename every file the plan names.
 *
 * Move the file first, then repoint the row: a crash therefore leaves files moved and rows
 * stale rather than rows pointing at files that are gone, and re-running finishes the job
 * because a book already at its target is no longer in the plan. One book whose file has
 * vanished is skipped and counted, never allowed to stop the rest.
 */
export async function renameLibraryFiles(ctx: Ctx): Promise<{ renamed: number; skipped: number }> {
  const { db, config } = ctx
  let renamed = 0
  let skipped = 0

  for (const plan of planRenames(db)) {
    const from = join(config.comicsDir, plan.from)
    const destDir = join(config.comicsDir, dirname(plan.to))
    try {
      // Never rename onto a comic that is already there. Claiming the name and moving
      // onto it is one step, under the lock every writer into comicsDir shares - a
      // download filing a comic mid-run must not be handed the name this plan just took.
      const to = await renameLock(async () => {
        const claimed = dedupeDestPath(destDir, plan.to.split('/').pop()!)
        await rename(from, claimed)
        return claimed
      })
      const relative = `${dirname(plan.to)}/${to.split('/').pop()!}`
      const row = db.prepare('SELECT edition_id FROM book WHERE id = ?').get(plan.bookId) as { edition_id: number }
      setBookEdition(db, plan.bookId, row.edition_id, relative)
      renamed++
    } catch (err) {
      skipped++
      console.warn(`rename: skipping book ${plan.bookId} (${plan.from}):`, err)
    }
  }

  return { renamed, skipped }
}
