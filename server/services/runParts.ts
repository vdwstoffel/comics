import { cacheVolumeIssues, getCachedVolumeIssues } from '../models/volumeIssues.js'
import { getVolumeCached } from '../models/volumeRecord.js'
import {
  mergeRun, volumeRefsFromDescription, hasNumberingGap, fitsInsideRun, numberSpan,
} from '../lib/runParts.js'
import type { RunIssue } from '../lib/runParts.js'
import type { ComicVineClient, CvVolumeIssue } from '../lib/comicvine.js'
import type { Db, Edition, RunPart } from '../types.js'

/** A part, with the stretch of the run it holds: "#7" to "#13". */
export interface RunPartSpan extends RunPart {
  first: string | null
  last: string | null
}

/**
 * The run as far as we already hold it: its own volume's issues and every part's, at any
 * age, without asking Comic Vine anything.
 *
 * What a press of Get, Get all and a follow read - each only ever follows a page view
 * that filled these caches. A part whose list we have never held adds nothing rather than
 * failing the run; the run's own volume missing is the only "nothing held".
 */
export function heldRun(db: Db, edition: Edition): { issues: RunIssue[]; fetchedAt: string } | undefined {
  if (edition.comicvineId == null) return undefined
  const own = getCachedVolumeIssues(db, edition.comicvineId, Infinity)
  if (!own) return undefined
  const parts = edition.cvParts.flatMap((part) => {
    const held = getCachedVolumeIssues(db, part.volumeId, Infinity)
    return held ? [{ name: part.name, issues: held.issues }] : []
  })
  return { issues: mergeRun(own.issues, parts), fetchedAt: own.fetchedAt }
}

/**
 * One volume's issue list: what we hold when it is fresh, Comic Vine when it is not, and
 * what we hold at any age when Comic Vine will not answer. Undefined only when there is
 * nothing at all.
 */
export async function readVolumeIssues(
  db: Db,
  cv: Pick<ComicVineClient, 'listVolumeIssues'>,
  volumeId: number,
  { refresh = false }: { refresh?: boolean } = {},
): Promise<{ issues: CvVolumeIssue[]; fetchedAt: string; stale: boolean } | undefined> {
  const fresh = refresh ? undefined : getCachedVolumeIssues(db, volumeId)
  if (fresh) return { ...fresh, stale: false }
  try {
    const issues = await cv.listVolumeIssues(volumeId)
    const fetchedAt = new Date().toISOString()
    cacheVolumeIssues(db, volumeId, issues, fetchedAt)
    return { issues, fetchedAt, stale: false }
  } catch {
    // A list we already hold beats no list at all, however old it is.
    const anyAge = getCachedVolumeIssues(db, volumeId, Infinity)
    return anyAge ? { ...anyAge, stale: true } : undefined
  }
}

/**
 * Like readVolumeIssues, but a Comic Vine that will not answer is an error rather than a
 * stale list. Detection must be able to tell "looked, and found nothing" from "could not
 * look", or a network blip would be recorded as an answer.
 */
async function volumeIssuesOrThrow(
  db: Db,
  cv: Pick<ComicVineClient, 'listVolumeIssues'>,
  volumeId: number,
): Promise<CvVolumeIssue[]> {
  const fresh = getCachedVolumeIssues(db, volumeId)
  if (fresh) return fresh.issues
  const issues = await cv.listVolumeIssues(volumeId)
  cacheVolumeIssues(db, volumeId, issues)
  return issues
}

/** The stretch a part holds, from whatever list we have for it. */
export function spanOf(db: Db, part: RunPart): RunPartSpan {
  const held = getCachedVolumeIssues(db, part.volumeId, Infinity)
  const span = held ? numberSpan(held.issues) : null
  return { ...part, first: span?.first ?? null, last: span?.last ?? null }
}

/**
 * How many linked volumes to try. A description links to a handful of volumes at most,
 * and each one tried costs a Comic Vine read; past this many the prose is a reading
 * list rather than a note about the run.
 */
const MAX_CANDIDATES = 5

/**
 * The volume Comic Vine's own note says holds part of this run, offered and never
 * applied.
 *
 * Two things have to agree. Comic Vine's description of the run links the volume -
 * Thor (2025)'s reads "Briefly renamed to Mortal Thor by indicia from #7-13" with the
 * link on the name - and that volume's numbering slots into a gap in the run's own,
 * picking up from the last issue before it. The prose alone links previous runs as
 * often as renamed stretches; the numbers alone would be a guess. Together they are
 * reliable enough to ask about, and asking is still all this does.
 *
 * Throws when Comic Vine cannot be asked, so the caller does not record a failed look as
 * a finding.
 */
export async function detectRunPart(
  { db, cv }: { db: Db; cv: Pick<ComicVineClient, 'listVolumeIssues' | 'getVolume'> },
  edition: Edition,
): Promise<RunPartSpan | null> {
  if (edition.comicvineId == null) return null

  const own = await volumeIssuesOrThrow(db, cv, edition.comicvineId)
  // A run with no gap in it has nowhere for another volume to go, and this is nearly
  // every run - so most editions cost one cached read here and nothing more.
  if (!hasNumberingGap(own)) return null

  const record = await getVolumeCached(db, cv, edition.comicvineId)
  if (!record) throw new Error('could not read the volume from Comic Vine')

  const answered = new Set([
    edition.comicvineId,
    ...edition.cvParts.map((p) => p.volumeId),
    ...edition.cvPartsDeclined,
  ])
  const candidates = volumeRefsFromDescription(record.descriptionHtml ?? '')
    .filter((id) => !answered.has(id))
    .slice(0, MAX_CANDIDATES)

  for (const volumeId of candidates) {
    const theirs = await volumeIssuesOrThrow(db, cv, volumeId)
    if (!fitsInsideRun(own, theirs)) continue

    const volume = await getVolumeCached(db, cv, volumeId)
    // Another publisher's volume with the right numbers is a coincidence, not a rename.
    if (record.publisher && volume?.publisher && record.publisher !== volume.publisher) continue

    const span = numberSpan(theirs)
    return {
      volumeId,
      name: volume?.name ?? null,
      startYear: volume?.startYear ?? null,
      siteUrl: volume?.siteUrl ?? null,
      first: span?.first ?? null,
      last: span?.last ?? null,
    }
  }
  return null
}
