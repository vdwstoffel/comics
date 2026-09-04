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
