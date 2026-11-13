import type { CvVolumeIssue } from './comicvine.js'

/**
 * One run filed under more than one Comic Vine volume.
 *
 * Comic Vine names a volume after its indicia, so a run whose title changes for a stretch
 * is split: Thor (2025) holds #1-6 and #800 up, and Mortal Thor holds #7-13 in between.
 * Read as one run, the follow goes from #6 to #7 rather than leaping to #800 - which is
 * the whole reason for putting the two back together.
 */

/**
 * An issue of the run. `volumeName` is present only on an issue filed under one of the
 * run's other volumes, and is that volume's name - the one its release posts go by,
 * and so the one a match has to key on.
 *
 * `annual` marks one of the run's annuals, read in from a volume of its own, and
 * `editionName` is where a copy of it is filed: its own annual edition, never the run's -
 * see `server/lib/runAnnuals.ts`.
 */
export type RunIssue = CvVolumeIssue & { volumeName?: string; annual?: true; editionName?: string }

/** Comic Vine's machine-readable reference to a volume, as it appears in its prose. */
const VOLUME_REF = /data-ref-id="4050-(\d+)"/g

/** Every volume a description links to, first mention first, each once. */
export function volumeRefsFromDescription(html: string): number[] {
  const ids: number[] = []
  for (const found of html.matchAll(VOLUME_REF)) {
    const id = Number(found[1])
    if (!ids.includes(id)) ids.push(id)
  }
  return ids
}

/**
 * The order the issue cache reads a volume back in - `ORDER BY number IS NULL,
 * CAST(number AS REAL), number` - so a run assembled from two volumes reads in the same
 * order one volume does. parseFloat is CAST's leading-number rule, and like CAST it
 * makes text nought.
 */
export function compareIssueNumbers(a: CvVolumeIssue, b: CvVolumeIssue): number {
  if (a.number == null || b.number == null) return Number(a.number == null) - Number(b.number == null)
  const real = (n: string) => {
    const value = Number.parseFloat(n)
    return Number.isNaN(value) ? 0 : value
  }
  const byValue = real(a.number) - real(b.number)
  if (byValue !== 0) return byValue
  return a.number < b.number ? -1 : a.number > b.number ? 1 : 0
}

/**
 * The run's own volume and its other volumes as one list, in issue order.
 *
 * A run with no other volumes comes back exactly as it went in, so every edition that is
 * one volume - which is nearly all of them - is untouched by any of this.
 */
export function mergeRun(
  own: CvVolumeIssue[],
  parts: Array<{ name: string | null; issues: CvVolumeIssue[] }>,
): RunIssue[] {
  if (parts.length === 0) return own
  const theirs = parts.flatMap(({ name, issues }) =>
    issues.map((issue): RunIssue => (name ? { ...issue, volumeName: name } : issue)))
  // Array.prototype.sort is stable, so a number both volumes use keeps the run's own
  // issue first.
  return [...own, ...theirs].sort(compareIssueNumbers)
}

/** Only plain numbers count: "7", "800", "7.1". "Annual 1" and "7.LR" say nothing here. */
function plainNumbers(issues: CvVolumeIssue[]): number[] {
  return issues
    .map((issue) => issue.number?.trim() ?? '')
    .filter((n) => /^\d+(\.\d+)?$/.test(n))
    .map(Number)
}

/** Whether the run skips any whole numbers at all. Most runs never do. */
export function hasNumberingGap(own: CvVolumeIssue[]): boolean {
  const numbers = [...new Set(plainNumbers(own).filter(Number.isInteger))].sort((a, b) => a - b)
  return numbers.some((n, i) => i > 0 && n > numbers[i - 1] + 1)
}

/**
 * Whether another volume's issues are a stretch of this run: every one of them sits in a
 * single gap in the run's numbering, and the first picks up exactly where the run left
 * off.
 *
 * This is what makes a suggestion trustworthy. Comic Vine's prose links plenty of
 * volumes that are not part of the run - "Continues from X-Men Vol. 7" is the run
 * before, and it overlaps this one from #1. Mortal Thor's #7-13 sit between Thor's #6
 * and #800 and start at #7; a previous or a following volume sits wholly before or
 * after, or restarts its numbers, and never does both.
 */
export function fitsInsideRun(own: CvVolumeIssue[], other: CvVolumeIssue[]): boolean {
  const ours = plainNumbers(own)
  const theirs = plainNumbers(other)
  if (ours.length === 0 || theirs.length === 0) return false

  const first = Math.min(...theirs)
  const last = Math.max(...theirs)
  if (ours.some((n) => n >= first && n <= last)) return false

  const before = ours.filter((n) => n < first)
  if (before.length === 0 || !ours.some((n) => n > last)) return false
  return Math.max(...before) + 1 === first
}

/**
 * Whether two volumes share an issue number. A volume added by hand is not held to
 * `fitsInsideRun` - a rename that never came back sits after the run, not inside it -
 * but one sharing numbers with the run would put two different #7s side by side, and
 * that is never one run.
 */
export function sharesNumbers(own: CvVolumeIssue[], other: CvVolumeIssue[]): boolean {
  const key = (n: string) => (/^\d+(\.\d+)?$/.test(n) ? String(Number(n)) : n.toLowerCase())
  const ours = new Set(own.map((i) => i.number?.trim()).filter((n): n is string => !!n).map(key))
  return other.some((i) => !!i.number?.trim() && ours.has(key(i.number.trim())))
}

/** The first and last issue numbers of a volume, for saying which stretch it is. */
export function numberSpan(issues: CvVolumeIssue[]): { first: string; last: string } | null {
  const numbered = issues.filter((i) => i.number?.trim()).sort(compareIssueNumbers)
  if (numbered.length === 0) return null
  return { first: numbered[0].number!, last: numbered[numbered.length - 1].number! }
}
