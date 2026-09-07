import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'

/**
 * Sanitize an edition name into a safe folder name.
 * Replaces `/` and `\` runs with `_`, then replaces `..` runs with `_`, then trims.
 * Returns "Unsorted" if the result would be empty.
 *
 * This matches the inline logic previously in server/routes/upload.ts.
 */
export function sanitizeEditionFolder(name: string): string {
  const sanitized = (name || 'Unsorted')
    .replace(/[\\/]+/g, '_')
    .replace(/\.\.+/g, '_')
    .trim()
  return sanitized || 'Unsorted'
}

/**
 * Where an edition's files live, relative to the comics dir: `<series>/<edition>`.
 *
 * Each segment goes through sanitizeEditionFolder separately, so a slash inside a
 * name collapses to `_` instead of silently becoming another folder level - the
 * library contains a series literally named "Amazing Spider-Man/Venom". An edition with
 * no series of its own - or whose series is just its own name - stays at the top level,
 * which is where Unsorted lives.
 */
export function editionFolderPath(seriesName: string | null | undefined, name: string): string {
  const leaf = sanitizeEditionFolder(name)
  const series = seriesName?.trim() ? sanitizeEditionFolder(seriesName) : ''
  // A series equal to the edition name is not a grouping - deriveSeriesName returns a
  // plain name unchanged, so nesting those would give Unsorted/Unsorted.
  if (!series || series === leaf) return leaf
  return `${series}/${leaf}`
}

/**
 * A destination that does not yet exist, de-duping with (2), (3), … suffixes.
 *
 * Every write into the comics dir goes through this. Without it a second file of the same
 * name renames straight over the first, destroying a comic and then failing the unique
 * constraint on book.file_path — the caller sees a 500 and the original is already gone.
 *
 * Pass srcAbsPath to exclude the source file itself, so moving a file to where it already
 * is does not dedupe against itself.
 */
export function dedupeDestPath(destDir: string, filename: string, srcAbsPath?: string): string {
  const ext = extname(filename)
  const base = filename.slice(0, filename.length - ext.length)
  let candidate = join(destDir, filename)
  let n = 2
  while (existsSync(candidate) && candidate !== srcAbsPath) {
    if (n > 9999) throw new Error('too many filename collisions')
    candidate = join(destDir, `${base} (${n})${ext}`)
    n++
  }
  return candidate
}
