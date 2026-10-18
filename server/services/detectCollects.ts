import { getEdition } from '../models/editions.js'
import { listBooksByEdition } from '../models/books.js'
import { volumeRefFromDescription, collectingLineFromIssue } from '../lib/collectsRef.js'
import { seriesMatchKey } from '../lib/seriesName.js'
import type { ComicVineClient } from '../lib/comicvine.js'
import type { Db } from '../types.js'

export interface CollectsProposal {
  volumeId: number
  name: string | null
  startYear: number | null
  siteUrl: string | null
}

interface DetectCtx {
  db: Db
  cv: ComicVineClient
}

/**
 * What an edition looks like it reprints, offered and never applied.
 *
 * Two sources, because neither covers everything. The collection volume's own
 * description carries a real linked volume id, which is the better answer - but The 8
 * Deaths of Spider-Man's description is empty, so the fallback is the trade's own
 * solicitation line, "COLLECTING: Amazing Spider-Man (2022) 61-70", which names the run
 * in words and has to be matched back to an id by name and year.
 *
 * Both are prose a person typed. Expect a good hit rate and regular misses: the stored
 * column is the feature, and this only ever fills in the first draft of it.
 *
 * Writes nothing. Spec §4 - "wait for a yes".
 */
export async function detectCollects(
  { db, cv }: DetectCtx,
  editionId: number,
): Promise<CollectsProposal | null> {
  const edition = getEdition(db, editionId)
  if (!edition?.comicvineId) return null

  const volumeId = await fromVolume(cv, edition.comicvineId)
    ?? await fromFirstBook(db, cv, editionId)

  // An edition that reprints its own volume reprints nothing: either Comic Vine's prose
  // is loose, or this is the run itself rather than a collection of one.
  if (volumeId == null || volumeId === edition.comicvineId) return null

  // Named from the volume it points at rather than from the prose, so the shelf heading
  // is Comic Vine's name for the run and not a copywriter's abbreviation of it.
  const volume = await cv.getVolume(volumeId).catch(() => null)
  return {
    volumeId,
    name: volume?.name ?? null,
    startYear: volume?.startYear ?? null,
    siteUrl: volume?.siteUrl ?? null,
  }
}

/** Source one: a `data-ref-id` after a collecting verb in the volume's description. */
async function fromVolume(cv: ComicVineClient, comicvineId: number): Promise<number | null> {
  const volume = await cv.getVolume(comicvineId).catch(() => null)
  return volume?.descriptionHtml ? volumeRefFromDescription(volume.descriptionHtml) : null
}

/**
 * Source two: the trade's own "COLLECTING:" line, resolved to an id by search.
 *
 * The year has to match as well as the name. "Amazing Spider-Man" alone finds the 1963
 * run first, and filing thirteen trades of the 2022 volume under a run from sixty years
 * earlier is a worse answer than none.
 */
async function fromFirstBook(db: Db, cv: ComicVineClient, editionId: number): Promise<number | null> {
  const book = listBooksByEdition(db, editionId).find((b) => b.comicvineId)
  if (!book?.comicvineId) return null

  const issue = await cv.getIssue(book.comicvineId).catch(() => null)
  const line = issue?.descriptionHtml ? collectingLineFromIssue(issue.descriptionHtml) : null
  if (!line?.startYear) return null

  const wanted = seriesMatchKey(line.name)
  const matches = await cv.searchVolumes(line.name).catch(() => [])
  const hit = matches.find((m) => m.startYear === line.startYear && seriesMatchKey(m.name ?? '') === wanted)
  return hit?.id ?? null
}
