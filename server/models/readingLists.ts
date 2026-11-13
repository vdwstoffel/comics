import { READING_LISTS } from '../readingLists/index.js'
import type { ListLength, ReadingList, ReadingListIssue, ReadingListPhase } from '../readingLists/types.js'
import type { Db } from '../types.js'

export function listReadingLists(): ReadingList[] {
  return READING_LISTS
}

export function getReadingListBySlug(slug: string): ReadingList | undefined {
  return READING_LISTS.find((l) => l.slug === slug)
}

export function getReadingListById(id: number): ReadingList | undefined {
  return READING_LISTS.find((l) => l.id === id)
}

/** Whether an issue is read in this length. Core leaves the tie-ins out; Full has them all. */
export function inLength(issue: ReadingListIssue, length: ListLength): boolean {
  return length === 'full' || !issue.extra
}

/** A phase's issues in reading order, through its sections when it has them. */
export function phaseIssues(phase: ReadingListPhase): ReadingListIssue[] {
  return phase.sections ? phase.sections.flatMap((s) => s.issues) : phase.issues
}

/**
 * The phases as this length reads them. A phase or section with nothing left in it is
 * dropped rather than drawn empty: the Interlude is all tie-ins, and in Core it is not a
 * part of the story at all.
 */
export function phasesIn(list: ReadingList, length: ListLength): ReadingListPhase[] {
  return list.phases.flatMap((phase): ReadingListPhase[] => {
    if (phase.sections) {
      const sections = phase.sections.flatMap((section) => {
        const issues = section.issues.filter((i) => inLength(i, length))
        return issues.length > 0 ? [{ ...section, issues }] : []
      })
      return sections.length > 0 ? [{ name: phase.name, note: phase.note, sections }] : []
    }
    const issues = phase.issues.filter((i) => inLength(i, length))
    return issues.length > 0 ? [{ name: phase.name, note: phase.note, issues }] : []
  })
}

/** The whole list in reading order, as one run - which is what Follow and every count walk. */
export function issuesIn(list: ReadingList, length: ListLength): ReadingListIssue[] {
  return phasesIn(list, length).flatMap(phaseIssues)
}

export function hasExtras(list: ReadingList): boolean {
  return list.phases.some((p) => phaseIssues(p).some((i) => i.extra))
}

/** Every list this Comic Vine issue appears in. */
export function listsHolding(cvIssueId: number): ReadingList[] {
  return READING_LISTS.filter((l) => l.phases.some((p) => phaseIssues(p).some((i) => i.cv === cvIssueId)))
}

/**
 * One list entry, by Comic Vine's id for it and nothing else - which is all the download
 * route is handed. An issue in two lists is the same issue either way, so the first found
 * answers.
 */
export function findReadingListIssue(cvIssueId: number): ReadingListIssue | undefined {
  for (const list of READING_LISTS) {
    for (const phase of list.phases) {
      const found = phaseIssues(phase).find((i) => i.cv === cvIssueId)
      if (found) return found
    }
  }
  return undefined
}

/**
 * Where you are in a run: the index of the issue after the LAST one you finished, the rule
 * a follow already keeps - a gap behind you is one you chose to skip. Nothing finished is
 * the first issue; everything finished is the length of the run, which names nothing.
 */
export function nextIssueIndex(issues: Array<{ cv: number }>, finishedIds: Set<number>): number {
  let at = -1
  for (const [i, issue] of issues.entries()) if (finishedIds.has(issue.cv)) at = i
  return at + 1
}

export interface BookReadingList {
  slug: string
  name: string
  /** 1-based place in the list's active length. Absent for a tie-in while it reads in Core. */
  position?: number
  total: number
  /** A tie-in the active length leaves out - shown in place of a position. */
  tieIn?: true
}

/**
 * Where this issue falls in each list holding it, counted in each list's own active
 * length - the "47 of 92" on the issue's page. Lists are local, so this costs no request.
 */
export function bookReadingLists(db: Db, cvIssueId: number | null | undefined): BookReadingList[] {
  if (cvIssueId == null) return []
  return listsHolding(cvIssueId).map((list) => {
    const run = issuesIn(list, getListLength(db, list.id))
    const at = run.findIndex((i) => i.cv === cvIssueId)
    return {
      slug: list.slug,
      name: list.name,
      ...(at === -1 ? { tieIn: true as const } : { position: at + 1 }),
      total: run.length,
    }
  })
}

export function getListLength(db: Db, listId: number): ListLength {
  const row = db.prepare('SELECT length FROM reading_list_length WHERE list_id = ?')
    .get(listId) as { length: ListLength } | undefined
  return row?.length ?? 'core'
}

export function setListLength(db: Db, listId: number, length: ListLength): void {
  db.prepare(
    `INSERT INTO reading_list_length (list_id, length) VALUES (?, ?)
     ON CONFLICT(list_id) DO UPDATE SET length = excluded.length`,
  ).run(listId, length)
}
