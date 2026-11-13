import { cacheVolumeSearch, getCachedVolumeSearch } from '../models/volumeSearch.js'
import { getCachedVolumeIssues } from '../models/volumeIssues.js'
import { getEditionByComicvineId, updateEdition } from '../models/editions.js'
import { readVolumeIssues, volumeIssuesOrThrow } from './runParts.js'
import { annualQuery, annualCandidates, annualIssuesInRun, isAnnualName } from '../lib/runAnnuals.js'
import type { RunIssue } from '../lib/runParts.js'
import type { ComicVineClient, CvVolumeIssue } from '../lib/comicvine.js'
import type { Db, Edition, RunPart } from '../types.js'

type Cv = Pick<ComicVineClient, 'searchVolumes' | 'listVolumeIssues'>

/** A run gains an annual a year at most, so a week between searches misses nothing. */
const ANNUALS_RECHECK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The volumes holding this run's annuals, from a Comic Vine search for "<run> Annual".
 *
 * A volume counts when its name is the run's plus "Annual", its publisher agrees, and at
 * least one of its issues came out while the run did. Throws when Comic Vine cannot be
 * asked, so a failed look is never recorded as "this run has no annuals".
 */
export async function findAnnualVolumes(db: Db, cv: Cv, edition: Edition, run: CvVolumeIssue[]): Promise<RunPart[]> {
  // An annual's own edition has no annuals of its own to look for.
  if (!edition.cvName || isAnnualName(edition.cvName)) return []
  const query = annualQuery(edition.cvName)
  let volumes = getCachedVolumeSearch(db, query)?.volumes
  if (!volumes) {
    volumes = await cv.searchVolumes(query)
    cacheVolumeSearch(db, query, volumes)
  }

  const candidates = annualCandidates(edition.cvName, edition.publisher, run, volumes)

  const found: RunPart[] = []
  for (const volume of candidates) {
    const issues = await volumeIssuesOrThrow(db, cv, volume.id)
    if (annualIssuesInRun(run, issues).length === 0) continue
    found.push({
      volumeId: volume.id,
      name: volume.name ?? null,
      startYear: volume.startYear ?? null,
      siteUrl: volume.siteUrl ?? null,
    })
  }
  return found
}

/**
 * Where a copy of this annual is filed: the edition that already holds its volume, or one
 * named after it. Never the run's own edition - a comic matched to another volume would
 * rename the edition it sits in after that volume.
 */
function annualEditionName(db: Db, annual: RunPart): string {
  const held = getEditionByComicvineId(db, annual.volumeId)
  if (held) return held.name
  const name = annual.name ?? 'Annual'
  return annual.startYear ? `${name} (${annual.startYear})` : name
}

/** One annual volume's issues as issues of the run: only its years', and marked. */
function asRunIssues(db: Db, run: CvVolumeIssue[], annual: RunPart, issues: CvVolumeIssue[]): RunIssue[] {
  const editionName = annualEditionName(db, annual)
  return annualIssuesInRun(run, issues).map((issue) => ({
    ...issue,
    annual: true as const,
    // Posted under its own name - "Batman Annual #2", not "Batman #2".
    ...(annual.name ? { volumeName: annual.name } : {}),
    editionName,
  }))
}

/**
 * The run's annuals for its page, looking for new annual volumes once a week or when the
 * run is refreshed.
 *
 * A search that fails keeps the volumes already known, unstamped, so the next view asks
 * again; an annual list that fails is left out and the run is reported stale, the same
 * way a part that cannot be read is.
 */
export async function readRunAnnuals(
  db: Db,
  cv: Cv,
  edition: Edition,
  run: CvVolumeIssue[],
  { refresh = false }: { refresh?: boolean } = {},
): Promise<{ issues: RunIssue[]; stale: boolean }> {
  let annuals = edition.cvAnnuals
  const checked = edition.cvAnnualsCheckedAt
    && Date.now() - new Date(edition.cvAnnualsCheckedAt).getTime() < ANNUALS_RECHECK_MS
  if (refresh || !checked) {
    try {
      annuals = await findAnnualVolumes(db, cv, edition, run)
      updateEdition(db, edition.id, { cvAnnuals: annuals, cvAnnualsCheckedAt: new Date().toISOString() })
    } catch {
      // Keep what we had; the stamp is not moved, so the next view looks again.
    }
  }

  const issues: RunIssue[] = []
  let stale = false
  for (const annual of annuals) {
    const held = await readVolumeIssues(db, cv, annual.volumeId, { refresh })
    if (!held || held.stale) stale = true
    if (held) issues.push(...asRunIssues(db, run, annual, held.issues))
  }
  return { issues, stale }
}

/**
 * The run's annuals as far as we already hold them, at any age and without asking Comic
 * Vine - what a press of Get or Get all reads, which only ever follows a page view.
 */
export function heldAnnuals(db: Db, edition: Edition, run: CvVolumeIssue[]): RunIssue[] {
  return edition.cvAnnuals.flatMap((annual) => {
    const held = getCachedVolumeIssues(db, annual.volumeId, Infinity)
    return held ? asRunIssues(db, run, annual, held.issues) : []
  })
}
