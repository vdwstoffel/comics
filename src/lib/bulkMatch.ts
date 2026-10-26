/**
 * Pairing a folder of comics with the issues of a Comic Vine volume.
 *
 * The rule this module exists to enforce: **a volume claims a file only when its series
 * and its number both agree.** Matching on the number alone is the obvious implementation
 * and it is wrong in a way that is worse than failing - `Avengers World 001.cbr` parses to
 * number 1, `Avengers (2013)` has an issue #1, and the user is shown a confident match to
 * the wrong comic. The review table is supposed to be the safety net; forty plausible rows
 * to audit is not a safety net.
 *
 * So a file left unplaced costs one dropdown, and a file matched wrongly costs a comic in
 * the library with another volume's metadata written into its archive. Everywhere this is
 * unsure, it refuses - the same position `matchIssue` takes in `server/lib/issueMatch.ts`,
 * where "two matches is no match".
 */

import { parseComicFileName, normalizeIssueNumber, seriesKey, baseIssueNumber } from './comicFileParse'

/** The library's archive formats. Case-insensitive: scene folders are not consistent. */
const COMIC_EXT = /\.(cbz|cbr)$/i

/**
 * `needs-issue` is a file this volume HAS claimed - its series agrees - but which no
 * issue of it could be paired with: a number the volume does not list, a number that
 * could not be read, or a number two files both wanted. It sits in that volume's group
 * with a picker, which is the whole reason it is distinct from `unplaced`: the volume is
 * already known, so the fix is choosing from a short list rather than searching again.
 */
export type BulkRowState =
  | 'matched' | 'owned-here' | 'owned-elsewhere' | 'needs-issue' | 'unplaced' | 'ignored'

/** One issue of a volume, reduced to what the matcher and the table read. */
export interface BulkIssue {
  id: number
  /** Comic Vine's own string. Absent and null both mean "no number", and match nothing. */
  number?: string | null
  name?: string | null
  coverDate?: string | null
  /** Whether the library holds this issue ANYWHERE - decided by Comic Vine id, never number. */
  owned?: boolean
  bookId?: number
  /** Where that copy actually lives, which is what separates owned-here from owned-elsewhere. */
  ownedIn?: { editionId: number; editionName: string }
}

/**
 * A volume a search has offered, as the matcher needs it.
 *
 * `editionId` is the library's EXISTING edition for this volume, or null when it has none.
 * It is here only to compare against `issue.ownedIn`. The name a batch should file into is
 * a different value and deliberately not on this type - the two were one field once and
 * meant two things.
 */
export interface BulkVolume {
  volumeId: number
  name: string
  startYear: number | null
  editionId: number | null
  issues: BulkIssue[]
}

export interface BulkRow {
  /** Unique per picked file. Two folders can hand us the same name; the table keys on this. */
  key: string
  fileName: string
  state: BulkRowState
  volumeId: number | null
  issue: BulkIssue | null
  /** Ticked by default only for a copy filed somewhere else - see `stateFor`. */
  replace: boolean
}

export function isComicFile(fileName: string): boolean {
  return COMIC_EXT.test(fileName)
}

/**
 * The starting rows for a set of picked files.
 *
 * The key carries the position because the name cannot: picking the same release out of
 * two folders is an ordinary thing to do, and two rows sharing a key would collapse into
 * one in the table and silently drop a file.
 */
export function buildRows(fileNames: string[]): BulkRow[] {
  return fileNames.map((fileName, i) => ({
    key: `${i}:${fileName}`,
    fileName,
    state: isComicFile(fileName) ? 'unplaced' : 'ignored',
    volumeId: null,
    issue: null,
    replace: false,
  }))
}

/** Which of the three "we have a pairing" states this is, and whether it replaces by default. */
function stateFor(issue: BulkIssue, volume: BulkVolume): { state: BulkRowState; replace: boolean } {
  if (!issue.owned) return { state: 'matched', replace: false }
  // No `ownedIn` means we cannot tell where the copy lives, and the safe reading of an
  // unknown is the one that does not delete anything.
  //
  // A volume with NO edition of its own is not that case. It means every copy the library
  // holds is filed under something else - which is exactly §5.4's motivating scenario,
  // six strays in Unsorted being the only copies you have. Guarding on
  // `volume.editionId != null` here read all of those as "already yours" and skipped
  // them, disabling the feature precisely where it was meant to earn its place. A null
  // editionId can never equal a real one, so the comparison alone is correct.
  const elsewhere = issue.ownedIn != null && issue.ownedIn.editionId !== volume.editionId
  return elsewhere
    ? { state: 'owned-elsewhere', replace: true }
    : { state: 'owned-here', replace: false }
}

/**
 * Claim this volume's issues for whichever rows are still unplaced.
 *
 * Rows that already carry a volume come back untouched, so a later search can never steal
 * an earlier match and the order the user searches in cannot change an answer already
 * given. Ignored rows are never claimed at all.
 */
export function claimForVolume(rows: BulkRow[], volume: BulkVolume): BulkRow[] {
  const volumeKey = seriesKey(volume.name)

  // Only the volume's numbered issues can be claimed. A null number matches nothing -
  // including a file whose own number failed to parse, which would otherwise pair two
  // unknowns and call it a match.
  const byNumber = new Map<string, BulkIssue[]>()
  for (const issue of volume.issues) {
    const n = normalizeIssueNumber(issue.number)
    if (n === null) continue
    const group = byNumber.get(n) ?? []
    group.push(issue)
    byNumber.set(n, group)
  }

  // Claimed on the SERIES alone. A file whose series agrees belongs to this volume even
  // when its number cannot be paired - that is what puts it in this group with a picker
  // instead of stranding it in the leftovers with no volume to pick from.
  //
  // `needs-issue` rows are reconsidered, and that is load-bearing for a folder spanning a
  // relaunch: Avengers (2013) claims "Avengers 010.cbr" on its series and cannot number
  // it, and if that pinned the file forever then Avengers (2016) - which really has a #10
  // - could never take it. The only affordance left would be a picker offering the 2013
  // issues, and a user following it would pair #10 with 2013's #2: the confident wrong
  // match the series rule exists to prevent, reached through the control meant to fix it.
  //
  // A row that is genuinely MATCHED, or owned, is still untouchable - a later search can
  // never steal an answer already given.
  const candidates = rows.filter((r) =>
    r.state !== 'ignored' && (r.volumeId === null || r.state === 'needs-issue'))
    .map((row) => ({ row, parsed: parseComicFileName(row.fileName) }))
    .filter(({ parsed }) => seriesKey(parsed.series) === volumeKey)
  const numbered = candidates.filter(({ parsed }) => parsed.number !== null)

  const claimed = new Map<string, BulkIssue>()
  const exactlyClaimed = new Set<number>()

  // Exact pass. This is what keeps a real 16.1 off the fallback below.
  for (const { row, parsed } of numbered) {
    const hits = byNumber.get(parsed.number!) ?? []
    if (hits.length !== 1) continue
    claimed.set(row.key, hits[0]!)
    exactlyClaimed.add(hits[0]!.id)
  }

  // Fallback pass: "24.NOW" is Marvel's cover branding on issue 24. Only for a number
  // with a dotted suffix, only when the base is unambiguous, and never onto an issue a
  // file already matched outright - that file is the better claim.
  for (const { row, parsed } of numbered) {
    if (claimed.has(row.key)) continue
    const base = baseIssueNumber(parsed.number!)
    if (base === null) continue
    const hits = byNumber.get(base) ?? []
    if (hits.length !== 1 || exactlyClaimed.has(hits[0]!.id)) continue
    claimed.set(row.key, hits[0]!)
  }

  // Two files for one issue is no answer, so neither gets it. A .cbr and a .cbz of the
  // same release is a likelier explanation than a matcher bug, and picking one silently
  // is the wrong half of that choice to make for someone.
  const perIssue = new Map<number, number>()
  for (const issue of claimed.values()) perIssue.set(issue.id, (perIssue.get(issue.id) ?? 0) + 1)
  for (const [key, issue] of claimed) {
    if ((perIssue.get(issue.id) ?? 0) > 1) claimed.delete(key)
  }

  const claimedByVolume = new Set(candidates.map(({ row }) => row.key))

  return rows.map((row) => {
    if (!claimedByVolume.has(row.key)) return row
    const issue = claimed.get(row.key)
    if (!issue) {
      return { ...row, state: 'needs-issue' as const, volumeId: volume.volumeId, issue: null, replace: false }
    }
    const { state, replace } = stateFor(issue, volume)
    return { ...row, state, volumeId: volume.volumeId, issue, replace }
  })
}

/**
 * The issues of this volume no row has taken, for the picker a `needs-issue` row offers.
 *
 * Offering one already spoken for would let the user create the very collision the
 * conflict sweep above refuses to make on its own.
 */
export function availableIssues(rows: BulkRow[], volume: BulkVolume): BulkIssue[] {
  const taken = new Set(rows.map((r) => r.issue?.id).filter((id): id is number => id != null))
  return volume.issues.filter((i) => !taken.has(i.id))
}

/** Pair one row with an issue by hand, as the picker does. */
export function assignIssue(rows: BulkRow[], key: string, issue: BulkIssue, volume: BulkVolume): BulkRow[] {
  return rows.map((row) => {
    if (row.key !== key) return row
    const { state, replace } = stateFor(issue, volume)
    return { ...row, state, volumeId: volume.volumeId, issue, replace }
  })
}
