import { createComicVine, CvApiError } from '../lib/comicvine.js'
import type { CvIssue, CvVolume } from '../lib/comicvine.js'
import { upsertManualEntry, recordManualCheck } from '../models/cvManualEntry.js'
import { getBook, updateBook } from '../models/books.js'
import type { BookUpdate } from '../models/books.js'
import { getEdition, updateEdition } from '../models/editions.js'
import type { EditionUpdate } from '../models/editions.js'
import { replaceBookCredits, replaceBookTagsOfKind, getBookCredits, getBookTags } from '../models/metadata.js'
import { syncComicInfoFile } from './comicinfoSync.js'
import type { BookCredit, BookTag } from '../models/metadata.js'
import { getComicVineKey } from '../models/settings.js'
import type { Ctx, Book } from '../types.js'

/**
 * Is there anything here worth writing?
 *
 * Judged on the value, never on `undefined` alone: Comic Vine sends JSON null for a field
 * nobody has filled in, and `issue_number` in particular comes back as ''. A record created
 * the day a comic ships is all of these, and it stays that way for days while Comic Vine
 * catalogues it.
 */
const has = (v: string | null | undefined): v is string => v != null && v.trim() !== ''

/**
 * The same question for a cover, with one extra refusal: Comic Vine is documented as
 * serving a generic placeholder image for a record that has no cover, and a placeholder
 * passes every null check there is while being exactly as empty as nothing.
 *
 * This is a precaution, not a reproduced bug — 200 sampled issues and all 208 covers in
 * the library contained no such url. It is one predicate because that is all the evidence
 * justifies; resist growing it into a placeholder detector.
 */
function hasCover(url: string | null | undefined): url is string {
  if (!has(url)) return false
  const file = url.split(/[?#]/)[0].split('/').pop() ?? ''
  return !/blank|missing/i.test(file)
}

export interface AppliedIssue {
  book: Book
  credits: BookCredit[]
  tags: BookTag[]
  /**
   * What this call actually moved, as field names: book columns by their BookUpdate key, plus
   * 'credits', 'characters', 'teams' and 'storyArcs' for a kind that was replaced.
   *
   * Computed here rather than by the client because the client holds no credits or tags to
   * compare against, so it could never see those change. Empty means the call was a no-op,
   * which is the usual outcome of refreshing a record Comic Vine has not catalogued yet.
   */
  changed: string[]
  /**
   * False when Comic Vine could not be read at all and only the id was bound - the §3.4
   * path, reached by a hand-typed id during an outage. True everywhere a response was
   * applied, including a response that turned out to be empty of everything but the link.
   */
  metadataApplied: boolean
}

/**
 * Put everything Comic Vine knows about an issue onto a book: its own fields, its credits
 * and tags, the volume's identity on the edition, and the whole lot back into the file as
 * ComicInfo.xml.
 *
 * This lives in a service because two callers need it — matching a book you already have,
 * and matching a comic as you upload it. Copied instead of shared, the two would drift,
 * and the drift would show up as metadata that depends on which screen you used.
 *
 * `opts.manual` says the id was TYPED BY THE USER rather than picked off a Comic Vine
 * search result. That changes two things: a Comic Vine that cannot be read no longer costs
 * the link (see below), and the comic is recorded on the reminder list. Both live here
 * rather than in the route because the library path and the upload path both come through
 * this one function, and a route-level copy of either would drift from the other.
 */
export async function applyIssueToBook(
  ctx: Ctx,
  bookId: number,
  issueId: number | string,
  opts: { manual?: boolean } = {},
): Promise<AppliedIssue> {
  const { db, config } = ctx
  const book = getBook(db, bookId)
  if (!book) throw new Error(`Book ${bookId} not found`)

  const cv = createComicVine({ apiKey: () => getComicVineKey(db) })

  /**
   * Two failures that must end differently, and THE HTTP STATUS TELLS THEM APART BACKWARDS.
   * This looks like a bug every time it is read; it is not. Branch on Comic Vine's own
   * `status_code`, never on the HTTP one.
   *
   *   - The id does not exist (a typo). Comic Vine answers HTTP 200 with status_code 101,
   *     "Object Not Found". Binding a comic to a record that is not there serves nobody and
   *     hides the typo behind a success message. Rejected: nothing is written.
   *   - Comic Vine cannot be read (HTTP 500 — which is what /search/ has been answering,
   *     the outage this whole feature exists for — or a network failure, or no API key).
   *     The id came from the user, not from Comic Vine, so a Comic Vine that will not
   *     answer costs the metadata and never the link. The id is bound anyway.
   *
   * So the 200 is the one that is refused and the 500 is the one that succeeds.
   */
  let meta: CvIssue
  try {
    meta = await cv.getIssue(issueId)
    // A record that was deleted answers SUCCESSFULLY — status_code 1 — with an empty
    // `results`, which maps to an issue carrying nothing at all, including no id. That is
    // "no such issue" in a different costume, and binding to it is as wrong as binding to a
    // typo, so it is raised as the same 101 the real thing raises. The id is the only field
    // that can say so: a record Comic Vine created yesterday is empty in every other one.
    if (meta.id == null) {
      throw Object.assign(
        new CvApiError(`Comic Vine error 101: Object Not Found (empty result for issue ${issueId})`),
        { cvStatus: 101 },
      )
    }
  } catch (err) {
    if (err instanceof CvApiError && err.cvStatus === 101) throw err
    // Without `manual` the id came from Comic Vine itself, so there is nothing to bind on
    // the user's authority and the failure propagates exactly as it always has —
    // storeComic's own catch is built on that throw.
    if (!opts.manual) throw err
    // cvSiteUrl is CLEARED here, not left alone, for the reason the success path's patch
    // spells out below: it is the link to whichever id was bound before. A book matched to
    // issue A and re-bound by hand to issue B would otherwise carry B's id beside A's page,
    // and both the book's own link and the Settings reminder row would open the wrong
    // comic. There was no response to read B's url from, so null is the only honest value.
    const patch: BookUpdate = { comicvineId: Number(issueId), cvSiteUrl: null }
    const bound = db.transaction(() => {
      // The link, and the reminder that explains why a comic is linked to a record with no
      // metadata on it, committed together.
      const b = updateBook(db, book.id, patch)
      upsertManualEntry(db, book.id, Number(issueId))
      return b
    })()
    return {
      book: (bound ?? book) as Book,
      credits: getBookCredits(db, book.id),
      tags: getBookTags(db, book.id),
      // Diffed against the row read at the top, exactly as the success path does it rather
      // than asserted: re-typing the id a book already carries moves nothing, and a
      // hardcoded ['comicvineId'] would report a change that did not happen.
      changed: Object.keys(patch).filter((k) =>
        (book as unknown as Record<string, unknown>)[k] !==
        (bound as unknown as Record<string, unknown> | undefined)?.[k]),
      metadataApplied: false,
    }
  }

  // Fetch the volume BEFORE opening the transaction: better-sqlite3 transactions must be
  // synchronous, so no await may appear inside one. Best-effort — a volume we cannot read
  // is no reason to lose the issue metadata we already have.
  let volume: CvVolume | undefined
  try {
    if (meta.volumeId) volume = await cv.getVolume(meta.volumeId)
  } catch { /* best-effort; don't fail the match */ }
  const publisher = volume?.publisher

  /**
   * Built by LEAVING KEYS OUT, which is the whole point of this function and must not be
   * "simplified" back into one object literal of `?? null`.
   *
   * updateBook writes every key it is handed, and syncComicInfoFile then writes the result
   * into the ComicInfo.xml inside the user's own .cbz. So a `?? null` here does not merely
   * decline to update a field — it erases that field from the database AND from the file on
   * disk. A Comic Vine record that has not been catalogued yet is empty in exactly the
   * fields a well-tagged book is full in, and new records stay thin for days after a comic
   * ships, which is precisely when someone reaches for a manual match.
   *
   * updateBook iterates `if (k in fields)`, so a key omitted here is a column it does not
   * touch. Comic Vine's silence therefore means "I have nothing to add", never "delete it".
   */
  const bookPatch: BookUpdate = {
    // The two exceptions, written thin record or not. comicvineId is the thing being set
    // and never comes from the response; cvSiteUrl is the link to that same id, returned
    // for every record, and leaving a previous record's link beside a new id would point
    // the book at the wrong page.
    comicvineId: Number(issueId),
    cvSiteUrl: meta.siteUrl ?? null,
  }
  if (has(meta.title)) bookPatch.title = meta.title
  if (has(meta.number)) bookPatch.number = meta.number
  if (has(meta.date)) bookPatch.date = meta.date
  if (has(meta.summary)) bookPatch.summary = meta.summary
  if (has(meta.writer)) bookPatch.writer = meta.writer
  if (has(meta.penciller)) bookPatch.penciller = meta.penciller
  if (hasCover(meta.coverUrl)) bookPatch.coverUrl = meta.coverUrl
  if (meta.year != null) bookPatch.year = meta.year
  if (has(publisher)) bookPatch.publisher = publisher

  // Judged per kind, for the same reason. replaceBookTags deletes every tag on the book in
  // one statement, so a record carrying characters and no story arcs would take the arcs
  // with it. An empty list means Comic Vine listed none of that kind — and because passing
  // [] to replaceBookTagsOfKind CLEARS that kind, "none" has to be a skipped call rather
  // than an empty one.
  const characters = meta.characters.map((c) => ({ kind: 'character', value: c.name, extId: c.id }))
  const teams = meta.teams.map((value) => ({ kind: 'team', value }))
  const arcs = meta.storyArcs.map((a) => ({ kind: 'story_arc', value: a.name, extId: a.id }))

  /**
   * What Comic Vine did NOT supply, for the reminder list to report (spec §5.3).
   *
   * Judged by the SAME predicates that decided what to write above — `has` for the strings,
   * `.length` for the lists, `hasCover` for the cover. One notion of "empty" per field:
   * two would eventually disagree, and the list would claim Comic Vine had filled in a
   * field this function had declined to write.
   *
   * It describes the RESPONSE, never the book. A comic that arrived with its own
   * ComicInfo.xml has a title whether or not Comic Vine does, and a list computed from the
   * book would read "complete" the moment you bound it.
   */
  const missing: string[] = []
  if (!has(meta.date)) missing.push('date')
  if (!has(meta.title)) missing.push('title')
  if (!has(meta.summary)) missing.push('summary')
  if (!meta.credits.length) missing.push('credits')
  if (!meta.characters.length) missing.push('characters')
  if (!hasCover(meta.coverUrl)) missing.push('cover')

  // The "before" side for credits and tags, read ahead of the transaction (a synchronous
  // read, kept out of the transaction body so nothing new lives in there).
  const creditsBefore = getBookCredits(db, book.id)
  const tagsBefore = getBookTags(db, book.id)

  const updatedBook = db.transaction(() => {
    const b = updateBook(db, book.id, bookPatch)
    if (meta.credits.length) replaceBookCredits(db, book.id, meta.credits)
    if (characters.length) replaceBookTagsOfKind(db, book.id, 'character', characters)
    if (teams.length) replaceBookTagsOfKind(db, book.id, 'team', teams)
    if (arcs.length) replaceBookTagsOfKind(db, book.id, 'story_arc', arcs)

    // Propagate the volume to the edition: publisher and Comic Vine identity if it has
    // none, and the volume's own name/year, which is what the edition should be called.
    // The name is only recorded here — applying it is a rename, and a rename moves files.
    if (book.editionId && (publisher || volume)) {
      const edition = getEdition(db, book.editionId)
      if (edition) {
        const patch: EditionUpdate = {}
        if (publisher && !edition.publisher) patch.publisher = publisher
        if (volume?.name) patch.cvName = volume.name
        if (volume?.startYear !== undefined) patch.cvStartYear = volume.startYear
        if (meta.volumeId && !edition.comicvineId) patch.comicvineId = Number(meta.volumeId)
        if (Object.keys(patch).length > 0) updateEdition(db, book.editionId, patch)
      }
    }

    // The reminder, written in the same transaction as the metadata it describes. Both
    // calls are plain synchronous statements, so the no-await rule above is untouched.
    //
    // upsertManualEntry clears checked_at and cv_missing when the id CHANGED — a check
    // recorded earlier describes whichever id was there before — and recordManualCheck
    // fills them straight back in on the next line anyway. The cleared state therefore
    // only ever survives on the failed-read path above, where "never read" is the honest
    // thing to say.
    if (opts.manual) upsertManualEntry(db, book.id, Number(issueId))
    // Unconditional, and a no-op for a book with no entry. A Refresh does not pass `manual`
    // — it is not a new hand-entry — but it is exactly when the list needs to learn that
    // Comic Vine has filled the record in since.
    recordManualCheck(db, book.id, missing)
    return b
  })()

  // Diff the snapshot read at the top against the row updateBook returned. Only keys we put
  // in the patch can have moved, so those are the ones compared.
  //
  // comicinfoSynced is deliberately NOT compared. syncComicInfoFile flips it on every call,
  // so counting it would make every refresh look like a change and the report would never
  // be able to say "nothing happened" - which is the whole reason this list exists. It is
  // also read from `updatedBook`, taken before the sync, so it could not appear here anyway;
  // do not "fix" that by diffing the post-sync row.
  const changed: string[] = Object.keys(bookPatch).filter((k) =>
    k !== 'comicinfoSynced' &&
    (book as unknown as Record<string, unknown>)[k] !== (updatedBook as unknown as Record<string, unknown>)?.[k])
  // Credits and tags are reported on DIFFERENCE, not on the replace having run. Refreshing a
  // record Comic Vine has not changed still carries its credits, so the guard fires and the
  // rows are rewritten identically; reporting that as a change would tell the user Comic
  // Vine had filled the record in when it had not. Compared as sets, so a reordering is not
  // news. Kinds stay separate, and a kind whose replace was skipped is identical by construction.
  const creditsAfter = getBookCredits(db, book.id)
  const tagsAfter = getBookTags(db, book.id)
  const sameSet = (x: string[], y: string[]) => {
    const a = [...x].sort(), b = [...y].sort()
    return a.length === b.length && a.every((v, i) => v === b[i])
  }
  const creditKeys = (l: BookCredit[]) => l.map((cr) => JSON.stringify([cr.name, cr.role]))
  const tagKeys = (l: BookTag[], kind: string) =>
    l.filter((t) => t.kind === kind).map((t) => JSON.stringify([t.value, t.extId ?? null]))
  if (!sameSet(creditKeys(creditsBefore), creditKeys(creditsAfter))) changed.push('credits')
  for (const [kind, name] of [['character', 'characters'], ['team', 'teams'], ['story_arc', 'storyArcs']] as const) {
    if (!sameSet(tagKeys(tagsBefore, kind), tagKeys(tagsAfter, kind))) changed.push(name)
  }

  // Everything Comic Vine just gave us goes into the file as well as the database.
  const synced = await syncComicInfoFile(ctx, book.id)

  return {
    // updateBook returns the row it wrote; a book we just read cannot vanish mid-call.
    book: (synced ?? updatedBook) as Book,
    credits: creditsAfter,
    tags: tagsAfter,
    changed,
    metadataApplied: true,
  }
}
