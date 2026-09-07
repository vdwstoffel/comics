/** Issue numbers pad to three digits, or a file manager sorts them 1, 10, 2. */
const PAD_TO = 3

/** A number, optionally signed, optionally with a `.1`/`.MU` style suffix. */
const NUMBER_RE = /^(-?)(\d+)(\.\w+)?$/

/**
 * Lowercase, underscore-joined, and stripped of anything that would make a path or need
 * quoting in a shell. Runs of separators collapse to one, so "Spider-Man/Venom: Death"
 * does not leave a trail of underscores where its punctuation was.
 */
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '')
}

/**
 * What an uploaded comic should be called once Comic Vine has identified it:
 * `<series>_<number><ext>`, as in `venom_256.cbz`.
 *
 * Returns null when there is not enough to build a name from — no series, or no issue
 * number. A number is what distinguishes two files in a run and what they sort by, so
 * without one the upload keeps the name it arrived with rather than being renamed on a
 * guess. Only a confirmed match earns a rename.
 */
export function comicFileName(
  series: string | null | undefined,
  number: string | null | undefined,
  ext: string,
): string | null {
  const seriesSlug = slug(series ?? '') || (series?.trim() ? 'comic' : '')
  if (!seriesSlug) return null

  const raw = (number ?? '').trim()
  if (!raw) return null

  const parts = NUMBER_RE.exec(raw)
  // A number we cannot read - "Annual", "½" - is kept as written rather than dropped.
  const numberSlug = parts
    ? `${parts[1]}${parts[2].padStart(PAD_TO, '0')}${parts[3] ?? ''}`
    : slug(raw)
  if (!numberSlug) return null

  return `${seriesSlug}_${numberSlug}${ext}`
}
