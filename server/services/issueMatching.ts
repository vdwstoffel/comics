import { parseNumber } from '../lib/comicTitle.js'
import { matchIssue, matchKey, YEAR_SLACK } from '../lib/issueMatch.js'
import type { IndexCandidate } from '../lib/issueMatch.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { Db } from '../types.js'
import type DatabaseType from 'better-sqlite3'

/** Which scraped row is this issue, for the page that offers to download it. */
export interface IssueMatch {
  indexId: number
  title: string
}

// Narrowed by number and year so only a handful of rows are read and judged in JS;
// matchKey is a function and cannot be expressed in SQL. Rows with no number or year
// can never satisfy the rule, and the comparisons exclude them here rather than later.
const CANDIDATES = `SELECT id, title, number, year FROM comic_index
                    WHERE number = ? AND year BETWEEN ? AND ?`

type CandidatesStatement = DatabaseType.Statement<[string, number, number], IndexCandidate>

// One prepared statement, reused across the run (spec §4.2) - better-sqlite3 has no
// statement cache of its own, so calling db.prepare() per issue recompiles the same SQL
// once for every un-owned issue. `db` is supplied per call rather than held at module
// scope (tests build a fresh one each time), so the cache keys on the handle itself
// rather than assuming there is only ever one.
const candidatesStmt = new WeakMap<Db, CandidatesStatement>()

function candidatesStatement(db: Db): CandidatesStatement {
  let stmt = candidatesStmt.get(db)
  if (!stmt) {
    stmt = db.prepare<[string, number, number], IndexCandidate>(CANDIDATES)
    candidatesStmt.set(db, stmt)
  }
  return stmt
}

/**
 * The one scraped row that is this Comic Vine issue, or nothing.
 *
 * `volumeName` is Comic Vine's name for the volume - never the edition's own name,
 * which is hand-editable and may be "Vol 7" or "Unsorted" and describe no series at all.
 */
export function findMatchForIssue(
  db: Db,
  volumeName: string | null,
  issue: CvVolumeIssue,
): IssueMatch | null {
  if (!volumeName?.trim() || !issue.number) return null

  const coverYear = issue.coverDate ? Number(String(issue.coverDate).slice(0, 4)) : NaN
  if (!Number.isInteger(coverYear)) return null

  // Both sides of the number comparison go through the same normaliser, so "5", "05"
  // and "005" are one value.
  const number = parseNumber(`#${issue.number}`)
  if (!number) return null

  const candidates = candidatesStatement(db).all(number, coverYear - YEAR_SLACK, coverYear + YEAR_SLACK)

  const hit = matchIssue(candidates, { matchKey: matchKey(volumeName), number, coverYear })
  return hit ? { indexId: hit.id, title: hit.title } : null
}
