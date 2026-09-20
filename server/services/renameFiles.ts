import { rename } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { comicFileName, slug } from '../lib/comicFileName.js'
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

/**
 * What tells this comic apart from another carrying the same number, as a filename
 * fragment, or nothing when we hold nothing that does.
 *
 * The issue title says it best, but Comic Vine leaves plenty of issues unnamed - the
 * "Death Spiral - Body Count" one-shot has no name at all, because what identifies it
 * is its volume rather than anything about the issue. The cover month is the fallback:
 * it is already on the row, it is what a reader would use to say which of two
 * same-numbered one-shots they mean, and two of them rarely ship in one month.
 */
function distinguisher(book: Book): string | null {
  const title = book.title?.trim()
  if (title) return slug(title) || null
  const date = book.date?.trim()
  return date ? slug(date) || null : null
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
          const part = distinguisher(book)
          // Nothing to tell it apart by: its current name has to stand, because that
          // name is then the only thing that does.
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
