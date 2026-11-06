import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** A missing directory, or a path that turned out not to be one. */
function isAbsent(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Bytes held by everything under `dir`, counted on disk rather than from the index.
 *
 * Deliberately not `SUM(book.file_size)`: the question is what the disk is carrying, and
 * the disk carries the files nothing has indexed too - a half-finished download, a comic
 * dropped into the folder by hand, the leavings of a scan that never ran.
 *
 * `readdir` reports a symlink as a symlink, not as what it points at, so links are
 * skipped: following one would bill the library for bytes that live somewhere else, and
 * a link pointing back up its own tree would walk until it ran out of stack.
 *
 * Nothing here holds still - a download lands, a rename moves a file - so an entry that
 * vanishes between being listed and being measured is expected, and weighs nothing.
 */
export async function directorySize(dir: string): Promise<number> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    // thumbnails and tmp are made at boot, but a fresh install can still be asked for its
    // size before anything has created them. Absent is a real answer: zero.
    if (isAbsent(err)) return 0
    throw err
  }

  let total = 0
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(path)
    } else if (entry.isFile()) {
      try {
        total += (await stat(path)).size
      } catch (err) {
        if (!isAbsent(err)) throw err
      }
    }
  }
  return total
}
