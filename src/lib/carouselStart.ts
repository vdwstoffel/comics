/**
 * Which issue of a run the volume page should open on.
 *
 * Kept apart from the carousel so the rule can be read and tested without rendering
 * anything: it decides what you see first on every volume page, and none of what it
 * weighs - whether a book is finished, whether an issue is in the library at all - is
 * visible in a cover.
 *
 * The rule is "carry on where you left off": the first issue of the run you have not
 * finished. A gap counts as unfinished, because an issue you do not have is one you
 * certainly have not read, and landing on it puts its Get button in front of you.
 */

/** Only the fields the rule reads. Narrower than ApiVolumeIssue plus its book on purpose. */
export interface RunEntry {
  owned: boolean
  /** Absent for a gap, and for a book whose read state has not been fetched yet. */
  readState?: 'unread' | 'reading' | 'read'
}

/**
 * The index to open at: the first unfinished issue, or the last issue of a run you have
 * read all of - the newest, which is where a reader caught up on a running series wants
 * to be. An empty run has nothing to choose, so it answers 0 rather than -1; the caller
 * has nothing to draw either way, and an index that is never valid is worse than one
 * that is valid the moment a single issue arrives.
 */
export function carouselStart(run: RunEntry[]): number {
  // 'reading' is unfinished: a comic you are partway through is still one you have to
  // read. Same reading of the word the Unread shelf uses.
  const next = run.findIndex((entry) => !entry.owned || entry.readState !== 'read')
  if (next !== -1) return next
  return run.length === 0 ? 0 : run.length - 1
}
