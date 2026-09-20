/**
 * Issue numbers pad to four digits, or a file manager sorts them 1, 10, 2.
 *
 * Four rather than three because the long-running titles have reached #1000 - Action
 * Comics, Detective Comics, and Amazing Spider-Man on its legacy numbering. At three,
 * padding stopped at 999 and "#1000" sorted in front of "#999", which is the one thing
 * this constant exists to prevent.
 *
 * Padding only ever widens: a number already past 9999 keeps every digit rather than
 * being truncated, so raising this again later is safe.
 */
const PAD_TO = 4

/** A number, optionally signed, optionally with a `.1`/`.MU` style suffix. */
const NUMBER_RE = /^(-?)(\d+)(\.\w+)?$/

/**
 * " - ", the gap between a volume and its subtitle: Comic Vine files the Death Spiral
 * one-shot as "Amazing Spider-Man/Venom: Death Spiral - Body Count". A hyphen with no
 * spaces around it is part of a word instead - "Spider-Man", "All-New Venom" - and is
 * left alone, so this cannot be folded into the character class below.
 */
const SPACED_HYPHEN = /\s+[-\u2013\u2014]\s+/g

/**
 * Lowercase, underscore-joined, and stripped of anything that would make a path or need
 * quoting in a shell. Runs of separators collapse to one, so "Spider-Man/Venom: Death"
 * does not leave a trail of underscores where its punctuation was.
 *
 * Exported because renaming a library file builds the rest of its name the same way, and
 * two copies of this drift: one grew the subtitle rule below and the other did not.
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(SPACED_HYPHEN, ' ')
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
