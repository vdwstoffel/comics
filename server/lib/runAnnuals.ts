import { matchKey } from './issueMatch.js'
import { compareIssueNumbers } from './runParts.js'
import type { RunIssue } from './runParts.js'
import type { CvVolumeIssue } from './comicvine.js'

/**
 * A run's annuals, read back into the run.
 *
 * Comic Vine never files an annual under the run it belongs to: Batman Annual #1 (2012)
 * is issue #1 of a volume called "Batman Annual", and nothing in Comic Vine links that
 * volume to Batman (2011). What ties them is the name and the dates - the annual came out
 * in July 2012, between Batman #9 and #10, and that is where a reader wants it.
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** An annual a month ahead of the run's first issue still belongs to it. */
const BEFORE_RUN_DAYS = 31
/**
 * And one up to three months past its last, which is how long a run's final annual can
 * trail it. Short enough that Batman Annual (2016) - January 2017, six months after
 * Batman (2011) ended - goes to the run that followed instead.
 */
const AFTER_RUN_DAYS = 92

/**
 * Whether a volume or edition is an annual: "Batman Annual", "Amazing Spider-Man Annual
 * (2026)". The server's copy of `isAnnual` in `src/lib/annuals.ts`.
 */
export function isAnnualName(name: string): boolean {
  return /\s+annuals?(\s*\(\d{4}\))?\s*$/i.test(name)
}

/** What Comic Vine is searched for: the run's own name, with "Annual" after it. */
export function annualQuery(runName: string): string {
  return `${runName.trim()} Annual`
}

/**
 * Whether a volume is named as this run's annual - "Batman Annual" for Batman, "Amazing
 * Spider-Man Annual" for The Amazing Spider-Man. The whole name must agree: "Batman: Bad
 * Seeds Annual" is not Batman's.
 */
export function isAnnualOf(runName: string, volumeName: string): boolean {
  const run = matchKey(runName)
  const theirs = matchKey(volumeName)
  return theirs === `${run} annual` || theirs === `${run} annuals`
}

/**
 * How many same-named volumes to read. Each one tried costs a Comic Vine read, and a
 * search for "Amazing Spider-Man Annual" offers a new volume for most years since 2015.
 */
const MAX_CANDIDATES = 4

/**
 * The volumes worth reading for this run's annuals, nearest the run first.
 *
 * Named as the run's annual and from its publisher - Panini, Egmont and Titan all
 * published a "Batman Annual" of their own - and not begun after the run had ended.
 * Newest first, because Comic Vine ranks by relevance, not by year: its answer for "The
 * Amazing Spider-Man Annual" led with 2015 and 2017, and with only a few read, the 2026
 * annual of a run from 2025 was found third by luck.
 */
export function annualCandidates<T extends { name?: string; startYear?: number; publisher?: string }>(
  runName: string,
  runPublisher: string | null,
  run: CvVolumeIssue[],
  volumes: T[],
): T[] {
  const span = datedSpan(run)
  if (!span) return []
  const lastYear = new Date((span.last + AFTER_RUN_DAYS) * DAY_MS).getUTCFullYear()
  return volumes
    .filter((v) => v.name && isAnnualOf(runName, v.name))
    .filter((v) => !runPublisher || !v.publisher || v.publisher === runPublisher)
    .filter((v) => v.startYear == null || v.startYear <= lastYear)
    .sort((a, b) => (b.startYear ?? -Infinity) - (a.startYear ?? -Infinity))
    .slice(0, MAX_CANDIDATES)
}

/** A Comic Vine cover date as a day number, or null when there is none to read. */
function dayOf(coverDate: string | undefined): number | null {
  if (!coverDate) return null
  const ms = Date.parse(coverDate.slice(0, 10))
  return Number.isNaN(ms) ? null : Math.floor(ms / DAY_MS)
}

/** The first and last cover dates of a run, as day numbers. Null for a run with none. */
export function datedSpan(issues: CvVolumeIssue[]): { first: number; last: number } | null {
  const days = issues.map((i) => dayOf(i.coverDate)).filter((d): d is number => d !== null)
  if (!days.length) return null
  return { first: Math.min(...days), last: Math.max(...days) }
}

/**
 * The issues of an annual volume that came out while the run did.
 *
 * Decided an issue at a time rather than for the whole volume, because some annual volumes
 * outlive the run they started with - Amazing Spider-Man Annual ran on through several
 * relaunches, and each of those runs should get the annuals of its own years. An issue
 * with no cover date cannot be placed, so it is left out rather than guessed at.
 */
export function annualIssuesInRun(run: CvVolumeIssue[], annual: CvVolumeIssue[]): CvVolumeIssue[] {
  const span = datedSpan(run)
  if (!span) return []
  return annual.filter((issue) => {
    const day = dayOf(issue.coverDate)
    return day !== null && day >= span.first - BEFORE_RUN_DAYS && day <= span.last + AFTER_RUN_DAYS
  })
}

/**
 * The run with its annuals in reading order: each annual just after the last issue of
 * the run dated on or before it.
 *
 * The run itself keeps its own order - by number, as it always has - and only the annuals
 * are placed by date. Sorting the whole run by date would let Comic Vine's uneven cover
 * dates reshuffle issues that have a perfectly good number to go by.
 *
 * "After the last one up to its date" rather than "before the first one past it": a run's
 * #0 sorts first but often came out a year in - Batman (2011) #0 is November 2012 - and
 * stopping at the first later-dated issue put an annual from July 2012 ahead of the whole
 * run. An annual dated before every issue opens the run, and one dated past them all
 * closes it.
 */
export function interleaveAnnuals(run: RunIssue[], annuals: RunIssue[]): RunIssue[] {
  if (annuals.length === 0) return run
  const runDays = run.map((issue) => dayOf(issue.coverDate))

  // Annuals by where they go - the count of run issues before them - in date order.
  const at = new Map<number, RunIssue[]>()
  const ordered = [...annuals].sort((a, b) =>
    (dayOf(a.coverDate) ?? Infinity) - (dayOf(b.coverDate) ?? Infinity) || compareIssueNumbers(a, b))
  for (const annual of ordered) {
    const day = dayOf(annual.coverDate)
    let after = day === null ? run.length : 0
    if (day !== null) {
      runDays.forEach((runDay, i) => { if (runDay !== null && runDay <= day) after = i + 1 })
    }
    at.set(after, [...(at.get(after) ?? []), annual])
  }

  return [
    ...(at.get(0) ?? []),
    ...run.flatMap((issue, i) => [issue, ...(at.get(i + 1) ?? [])]),
  ]
}
