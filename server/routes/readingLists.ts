import {
  listReadingLists, getReadingListBySlug, issuesIn, hasExtras, nextIssueIndex,
  getListLength, setListLength, findReadingListIssue,
} from '../models/readingLists.js'
import type { ListLength, ReadingList, ReadingListIssue } from '../readingLists/types.js'
import { ownedIssueIds } from '../models/arcs.js'
import { finishedIssueIds, deriveReadState } from '../models/progress.js'
import { getBook } from '../models/books.js'
import { getEditionByComicvineId } from '../models/editions.js'
import { findMatchForIssue } from '../services/issueMatching.js'
import { startIssueDownload, issueLabel, pickedRow } from '../services/issueDownload.js'
import type { PickedRowBody } from '../services/issueDownload.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { App, Db } from '../types.js'

interface SlugParams { slug: string }

const LENGTHS: ListLength[] = ['core', 'full']
const isLength = (v: unknown): v is ListLength => LENGTHS.includes(v as ListLength)

/**
 * One entry as the page draws it, in the arc page's own terms - an owned issue carries its
 * book and read state, a missing one its match - so the two pages can share the tile.
 */
function issueView(db: Db, owned: Map<number, number>, entry: ReadingListIssue) {
  const issue = {
    id: entry.cv,
    number: entry.number,
    volumeName: entry.volume,
    volumeId: entry.volumeId,
    ...(entry.coverDate ? { coverDate: entry.coverDate } : {}),
    ...(entry.title ? { name: entry.title } : {}),
    // A missing issue's tile opens Comic Vine, the way an arc's does.
    ...(entry.siteUrl ? { siteUrl: entry.siteUrl } : {}),
    extra: !!entry.extra,
  }
  const bookId = owned.get(entry.cv)
  // Only what you are missing is worth matching, and the match keys on the issue's own
  // volume - a list crosses runs the way an arc does.
  if (bookId == null) {
    return { ...issue, owned: false, match: findMatchForIssue(db, entry.volume, { id: entry.cv, number: entry.number, coverDate: entry.coverDate }) }
  }
  const book = getBook(db, bookId)
  if (!book) return { ...issue, owned: true, bookId }
  const { readState, percent } = deriveReadState(db, book)
  return { ...issue, owned: true, bookId, readState, percent }
}

/** The next issue in each length, by Comic Vine id, or null when you have read it all. */
function nextIn(list: ReadingList, finished: Set<number>) {
  const next = (length: ListLength) => {
    const run = issuesIn(list, length)
    return run[nextIssueIndex(run, finished)]?.cv ?? null
  }
  return { core: next('core'), full: next('full') }
}

export interface ReadingListRouteOpts {
  /** Injected so tests never touch the network. */
  fetchPage?: (url: string) => Promise<string>
}

export default async function readingListRoutes(app: App, opts: ReadingListRouteOpts = {}) {
  const { fetchPage = fetchSourcePage } = opts

  /**
   * The shelf: each list's row. Its size in both lengths, so you can weigh what you would
   * be starting; where you are, counted in the length you read it in, since that is the run
   * you are working through; and the comic to open next, by the rule a follow uses.
   */
  app.get('/api/lists', async () => {
    const owned = ownedIssueIds(app.db)
    const finished = finishedIssueIds(app.db)
    return {
      lists: listReadingLists().map((list) => {
        const length = getListLength(app.db, list.id)
        const run = issuesIn(list, length)
        const read = run.filter((i) => finished.has(i.cv)).length
        const next = run[nextIssueIndex(run, finished)]
        const nextBook = next && owned.get(next.cv)
        return {
          id: list.id,
          slug: list.slug,
          name: list.name,
          publisher: list.publisher ?? null,
          years: list.years ?? null,
          description: list.description ?? null,
          cover: list.cover ?? null,
          size: { core: issuesIn(list, 'core').length, full: issuesIn(list, 'full').length },
          length,
          total: run.length,
          read,
          // Only once you have started - an unread list is opened, not continued - and only
          // when it is a comic you have, as on the list's page: a gap has nothing to open.
          next: read > 0 && next && nextBook != null
            ? { bookId: nextBook, label: issueLabel(next.volume, next.number) ?? next.volume }
            : null,
        }
      }),
    }
  })

  /**
   * The whole list, in Full, with every tie-in marked. The page leaves the tie-ins out
   * itself when it reads in Core, so flipping the switch redraws without a request; what
   * it cannot work out alone is where you are, so the next issue comes from here, in both
   * lengths, by the same rule a follow uses.
   */
  app.get<{ Params: SlugParams }>('/api/lists/:slug', async (req, reply) => {
    const list = getReadingListBySlug(req.params.slug)
    if (!list) return reply.code(404).send({ error: 'no such reading list' })

    const owned = ownedIssueIds(app.db)
    return {
      list: {
        id: list.id,
        slug: list.slug,
        name: list.name,
        publisher: list.publisher ?? null,
        years: list.years ?? null,
        description: list.description ?? null,
        cover: list.cover ?? null,
      },
      length: getListLength(app.db, list.id),
      hasExtras: hasExtras(list),
      next: nextIn(list, finishedIssueIds(app.db)),
      // Every phase as sections, so the page has one shape to draw: a phase the guide does
      // not split is a single section with no name of its own.
      phases: list.phases.map((phase) => ({
        name: phase.name,
        note: phase.note ?? null,
        sections: (phase.sections ?? [{ name: null, note: undefined, issues: phase.issues }]).map((section) => ({
          name: section.name,
          note: section.note ?? null,
          issues: section.issues.map((entry) => issueView(app.db, owned, entry)),
        })),
      })),
    }
  })

  /** Read this list short or long. Follow reads the same row, so what it queues follows. */
  app.put<{ Params: SlugParams; Body: { length?: unknown } }>('/api/lists/:slug/length', async (req, reply) => {
    const list = getReadingListBySlug(req.params.slug)
    if (!list) return reply.code(404).send({ error: 'no such reading list' })
    const length = req.body?.length
    if (!isLength(length)) return reply.code(400).send({ error: "length is 'core' or 'full'" })
    setListLength(app.db, list.id, length)
    return { length }
  })

  /**
   * Download the one scraped release that is this missing list issue. The arc route's rule
   * for where it lands, for the arc route's reason: an edition already claiming the Comic
   * Vine volume takes it, and otherwise the volume's own name makes one. The match is
   * re-derived here rather than taken from the page, so a rescrape between the render and
   * the press cannot turn the button into a download of something else.
   */
  app.post<{ Params: { cvIssueId: string }; Body: PickedRowBody }>(
    '/api/lists/issues/:cvIssueId/download',
    async (req, reply) => {
      const entry = findReadingListIssue(Number(req.params.cvIssueId))
      if (!entry) return reply.code(404).send({ error: 'issue not in any reading list' })

      const existing = getEditionByComicvineId(app.db, entry.volumeId)
      const result = await startIssueDownload(app, {
        volumeName: entry.volume,
        editionName: existing?.name ?? entry.volume,
        issue: { id: entry.cv, number: entry.number, coverDate: entry.coverDate },
        label: issueLabel(entry.volume, entry.number),
        indexId: pickedRow(req.body),
        fetchPage,
      })
      if (!result.ok) {
        return reply.code(result.code).send({ reason: result.reason, error: result.error, entry: result.entry })
      }
      return reply.code(202).send({ queued: true, entry: result.entry })
    },
  )
}
