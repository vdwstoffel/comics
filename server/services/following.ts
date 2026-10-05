import * as followingModule from './following.js'
import { getBookTags } from '../models/metadata.js'
import { getFollow, listFollows } from '../models/follows.js'
import { getEdition, getEditionByComicvineId } from '../models/editions.js'
import { listBooksByEdition } from '../models/books.js'
import { createComicVine } from '../lib/comicvine.js'
import { getComicVineKey } from '../models/settings.js'
import { cacheVolumeIssues, getCachedVolumeIssues, VOLUME_CACHE_MAX_AGE_MS } from '../models/volumeIssues.js'
import { getProgress, finishedIssueIds } from '../models/progress.js'
import type { Follow } from '../models/follows.js'
import { cacheArc, getCachedArc, ARC_CACHE_MAX_AGE_MS } from '../models/arcCache.js'
import { getArcOrder } from '../models/arcOrder.js'
import { applySavedOrder } from '../lib/arcOrder.js'
import { ownedIssueIds } from '../models/arcs.js'
import type { CvArcIssue, CvVolumeIssue } from '../lib/comicvine.js'
import { startIssueDownload, issueLabel } from './issueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App, Book, Db } from '../types.js'

/**
 * What a follow is waiting for, named by spec §3.1 and carried unchanged all the way to
 * the tile. `unresolved` is the fifth: a volume follow whose edition has been deleted or
 * was never matched to Comic Vine. It is what the list route prunes on. Arc follows never
 * come back `unresolved`; an arc with no cached issues is `caught-up`.
 */
export type FollowOutcome =
  | {
      state: 'wanted'
      issue: CvVolumeIssue
      /** Comic Vine's name for the volume: what the match keys on. */
      volumeName: string | null
      /** The edition's own name: where the file lands. */
      editionName: string
    }
  | { state: 'supplied' }
  | { state: 'dormant' }
  | { state: 'caught-up' }
  | { state: 'unresolved' }

/**
 * The one issue this follow should fetch, or why there is none.
 *
 * Entirely local: the cached issue list, what you own, and what you have finished. A
 * Comic Vine read only ever happens in the sweep, and only for a `caught-up` follow,
 * because that is the only state a fresher list could change.
 */
export function nextWantedIssue(db: Db, follow: Follow): FollowOutcome {
  return follow.kind === 'volume' ? volumeOutcome(db, follow) : arcOutcome(db, follow)
}

function volumeOutcome(db: Db, follow: Follow): FollowOutcome {
  const edition = getEdition(db, follow.refId)
  // No edition, or one never matched to a volume: there is no issue list to walk and no
  // name to match on. The list route drops the follow rather than showing a dead tile.
  if (!edition || edition.comicvineId == null) return { state: 'unresolved' }

  // Read at any age. Freshness is the sweep's job; a day-old list still answers "what
  // comes after the one I finished" correctly for every issue it does hold.
  const cached = getCachedVolumeIssues(db, edition.comicvineId, Infinity)
  if (!cached) return { state: 'caught-up' }

  const ownedIds = new Set<number>()
  const finishedIds = new Set<number>()
  for (const book of listBooksByEdition(db, edition.id)) {
    if (book.comicvineId == null) continue
    ownedIds.add(book.comicvineId)
    if (getProgress(db, book.id).completed) finishedIds.add(book.comicvineId)
  }

  const at = lastFinishedIndex(cached.issues, finishedIds)
  if (at === -1) return { state: 'dormant' }

  const next = cached.issues[at + 1]
  if (!next) return { state: 'caught-up' }
  if (ownedIds.has(next.id)) return { state: 'supplied' }

  return { state: 'wanted', issue: next, volumeName: edition.cvName, editionName: edition.name }
}

/**
 * How far down the run you have read: the LAST issue you finished, not the first gap.
 * A gap behind you is one you chose to skip, and a follow that reopened it would fight
 * you about a comic you have already read past.
 */
function lastFinishedIndex(issues: Array<{ id: number }>, finishedIds: Set<number>): number {
  let at = -1
  for (const [i, issue] of issues.entries()) if (finishedIds.has(issue.id)) at = i
  return at
}

function arcOutcome(db: Db, follow: Follow): FollowOutcome {
  const cached = getCachedArc(db, follow.refId, Infinity)
  if (!cached) return { state: 'caught-up' }

  // The order YOU put the arc in outranks the one dates computed - applied here for the
  // same reason the arc route applies it in one place: the shelf and the arc page must
  // never disagree about which issue comes next.
  const issues = applySavedOrder(cached.arc.issues, getArcOrder(db, follow.refId))

  // Library-wide, not per-edition: an arc crosses volumes by definition, and most of what
  // it is missing are tie-ins belonging to other runs entirely.
  const owned = ownedIssueIds(db)

  const finishedIds = finishedIssueIds(db)

  const at = lastFinishedIndex(issues, finishedIds)
  if (at === -1) return { state: 'dormant' }

  const next = issues[at + 1]
  if (!next) return { state: 'caught-up' }
  if (owned.has(next.id)) return { state: 'supplied' }

  return {
    state: 'wanted',
    issue: asVolumeIssue(next),
    // The tie-in's OWN volume, never the arc's name: the match keys on the volume the
    // issue belongs to, and most of an arc is not the title it is named after.
    volumeName: next.volumeName ?? null,
    editionName: editionNameFor(db, next) ?? follow.name,
  }
}

/** Where a part of an arc lands: its volume's edition if we hold one, else its own name. */
function editionNameFor(db: Db, issue: CvArcIssue): string | undefined {
  const edition = issue.volumeId == null ? undefined : getEditionByComicvineId(db, issue.volumeId)
  return edition?.name ?? issue.volumeName
}

/**
 * An arc issue as the download path wants it. A structural cast would compile - the
 * fields line up today - but the two types are owned by different parts of Comic Vine's
 * api and the extra ones (`storeDate`, `volumeId`) have no meaning downstream.
 */
function asVolumeIssue(issue: CvArcIssue): CvVolumeIssue {
  return {
    id: issue.id,
    ...(issue.number == null ? {} : { number: issue.number }),
    ...(issue.name == null ? {} : { name: issue.name }),
    ...(issue.coverDate == null ? {} : { coverDate: issue.coverDate }),
    ...(issue.siteUrl == null ? {} : { siteUrl: issue.siteUrl }),
  }
}

/**
 * Fetch what this follow is waiting for, if anything.
 *
 * Everything past "which issue" is the path a single Get press already takes, so the
 * match is re-derived at the moment of queueing and a double-queue is refused by the
 * partial unique index rather than by a check that could interleave.
 *
 * Every refusal is a non-event: the want is still wanted, and the next sweep works it
 * out again from scratch. That is the whole of the error handling, and it is this short
 * because nothing about the attempt is stored.
 */
export async function attemptFollow(
  app: App,
  follow: Follow,
  /** Injected so tests never touch the network. */
  fetchPage: (url: string) => Promise<string> = fetchSourcePage,
): Promise<'queued' | 'skipped'> {
  const outcome = nextWantedIssue(app.db, follow)
  if (outcome.state !== 'wanted') return 'skipped'

  const result = await startIssueDownload(app, {
    volumeName: outcome.volumeName,
    editionName: outcome.editionName,
    issue: outcome.issue,
    label: issueLabel(outcome.volumeName, outcome.issue.number),
    fetchPage,
  })
  return result.ok ? 'queued' : 'skipped'
}

/**
 * Attempt every follow this comic belongs to: the run it sits in, and any arc it carries
 * a tag for. Arcs are matched on the tag's Comic Vine id rather than its name - an arc
 * follow is stored under that id, and names get restated by re-matching.
 *
 * Each attempt is wrapped. One follow failing must never stop the next.
 */
export async function attemptFollowsForBook(
  app: App,
  book: Book,
  fetchPage: (url: string) => Promise<string> = fetchSourcePage,
): Promise<void> {
  const due: Follow[] = []

  const volume = getFollow(app.db, 'volume', book.editionId)
  if (volume) due.push(volume)

  const arcIds = new Set(
    getBookTags(app.db, book.id)
      .filter((t) => t.kind === 'story_arc' && t.extId != null)
      .map((t) => t.extId as number),
  )
  if (arcIds.size > 0) {
    for (const follow of listFollows(app.db)) {
      if (follow.kind === 'arc' && arcIds.has(follow.refId)) due.push(follow)
    }
  }

  for (const follow of due) {
    try {
      await followingModule.attemptFollow(app, follow, fetchPage)
    } catch (err) {
      // Typed refusals return 'skipped' without throwing, so anything landing here is a fault.
      app.log.warn({ err, kind: follow.kind, refId: follow.refId }, 'follow attempt failed')
    }
  }
}

/**
 * The sweep in flight, so two scrapes finishing together cannot start two of them. One
 * handle rather than a boolean, because tests have to be able to wait for it.
 */
let sweeping: Promise<void> | null = null

/** Resolves when no sweep is running. Tests await it; nothing else needs it. */
export async function followSweepIdle(): Promise<void> {
  while (sweeping) await sweeping
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retry every follow, in the background.
 *
 * Called when a scrape finishes, which is the precise moment a match can become newly
 * possible: fresh index rows are the only thing that turns a `no-match` into a download.
 *
 * Paced three seconds apart for the reason `queueMissingIssues` is paced - each attempt
 * fetches a post from someone else's site, and a burst is what gets a scraper shut out.
 *
 * Returns synchronously with what it is about to attempt; the downloads themselves
 * arrive over the following minutes.
 */
export function sweepFollows(
  app: App,
  { fetchPage = fetchSourcePage, delayMs = 3000, refreshLimit = 20 }: {
    fetchPage?: (url: string) => Promise<string>
    /** The pause between follows. Injected as 0 by tests, which have no site to spare. */
    delayMs?: number
    /** Comic Vine reads per sweep, against a budget of 200 an hour for the whole app. */
    refreshLimit?: number
  } = {},
): { swept: number } | { already: true } {
  if (sweeping) return { already: true }

  const follows = listFollows(app.db)
  if (follows.length === 0) return { swept: 0 }

  const run = (async () => {
    // A refresh failing must never stop the attempts: they are the part that matters.
    try { await refreshCaughtUp(app, follows, refreshLimit) } catch { /* keep the lists we hold */ }
    for (const [i, follow] of follows.entries()) {
      try {
        // The snapshot is minutes old at default pacing: skip a follow removed meanwhile,
        // or an arc unfollowed mid-sweep could still queue a download.
        if (!getFollow(app.db, follow.kind, follow.refId)) continue
        await followingModule.attemptFollow(app, follow, fetchPage)
      } catch (err) {
        // One follow must never end the sweep, but a throw is unexpected: say so.
        app.log.warn({ err, kind: follow.kind, refId: follow.refId }, 'follow attempt failed')
      }
      if (delayMs && i < follows.length - 1) await sleep(delayMs)
    }
  })().finally(() => { sweeping = null })
    // Terminal catch, after the finally so the guard still clears: the handle is floating
    // on the scrape path, and a rejection there would be an unhandled one that kills Node.
    .catch(() => {})

  sweeping = run
  return { swept: follows.length }
}

/**
 * Re-read the issue list for follows that have run out of it.
 *
 * Only `caught-up` follows: every other state is already answered from local tables, and
 * a fresher list could not change any of them. Without a key there is nothing to ask, and
 * matching against the index still works perfectly well - so this is skipped, not fatal.
 */
async function refreshCaughtUp(app: App, follows: Follow[], limit: number): Promise<void> {
  if (!getComicVineKey(app.db)) return
  const cv = createComicVine({ apiKey: () => getComicVineKey(app.db) })

  let spent = 0
  for (const follow of follows) {
    if (spent >= limit) return

    try {
      // Inside the try: a database fault here must cost one follow's refresh, not the sweep.
      if (nextWantedIssue(app.db, follow).state !== 'caught-up') continue
      if (follow.kind === 'volume') {
        const edition = getEdition(app.db, follow.refId)
        if (!edition?.comicvineId) continue
        // Fresh enough already: a running volume gains an issue a month.
        if (getCachedVolumeIssues(app.db, edition.comicvineId, VOLUME_CACHE_MAX_AGE_MS)) continue
        spent++
        cacheVolumeIssues(app.db, edition.comicvineId, await cv.listVolumeIssues(edition.comicvineId))
      } else {
        if (getCachedArc(app.db, follow.refId, ARC_CACHE_MAX_AGE_MS)) continue
        spent++
        cacheArc(app.db, follow.refId, await cv.getStoryArc(follow.refId))
      }
    } catch {
      // Comic Vine declining is a reason to keep the list we hold, not to stop the sweep.
    }
  }
}
