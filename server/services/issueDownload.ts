import { findMatchForIssue } from './issueMatching.js'
import { comicIndexById } from '../models/comicIndex.js'
import { parseDownloadLink } from '../lib/comicPostPage.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { QueueEntry } from '../models/downloadQueue.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { App } from '../types.js'

/**
 * The body every gap-filling route now accepts: which scraped row the user picked, when
 * they picked one rather than letting the server derive it.
 *
 * All three routes took no body until Find's dialog existed, and a press of Get still
 * sends none - so every field is optional and an absent body is the old behaviour.
 */
export interface PickedRowBody { indexId?: number }

/**
 * Read a picked row id off a request body, or nothing.
 *
 * Nothing is the answer for an absent body, a body that is not an object, and anything
 * that is not a positive whole number - a client that sends rubbish gets the derived
 * match, which is what it would have got before it sent anything.
 */
export function pickedRow(body: unknown): number | undefined {
  const raw = (body as PickedRowBody | null | undefined)?.indexId
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined
}

export type IssueDownloadResult =
  | { ok: true; entry: QueueEntry }
  | { ok: false; code: 404 | 409 | 502; reason: 'no-match' | 'duplicate' | 'unreadable' | 'no-link'; error: string; entry?: QueueEntry }

/**
 * What the queue calls an issue: Comic Vine's volume name and the issue number,
 * `Wolverine #27`. Both halves are nullable, so the join can come out empty - and an empty
 * string is not null, so it would survive every `?? entry.url` fallback downstream and
 * render as a blank row with an aria-label reading "Cancel ". Nothing to say returns
 * nothing, and the caller falls back.
 */
export function issueLabel(volumeName?: string | null, number?: string | null): string | undefined {
  return [volumeName, number && `#${number}`].filter(Boolean).join(' ').trim() || undefined
}

/**
 * Everything between "this issue is missing" and "the downloader is running": settle which
 * scraped row this is, fetch the post, parse the link out of it, start.
 *
 * Which row, in two ways. Without `indexId` the match is re-derived here rather than taken
 * from the client: the page that offered Get computed one, but the index can be rescraped
 * between the render and the press, and an *inference* the server did not make is one
 * nobody checked.
 *
 * With `indexId` a person read the titles and picked that row - which is what Find's dialog
 * is for, and it is strictly more checked than any rule. So the derivation is skipped
 * rather than second-guessed; the index's numbering and Comic Vine's disagree often enough
 * (`The Mortal Thor #14` is Comic Vine's `#800`) that re-deriving would overrule the person
 * on exactly the gaps they opened the dialog to fix. The row must still exist, and
 * everything after this point - fetch, parse, enqueue, duplicate detection - is unchanged.
 *
 * `volumeName` is Comic Vine's name for the volume and is what the derived match keys on;
 * a chosen row does not need it. `editionName` is where the file lands - the same thing for
 * the Latest tab, but an edition's own hand-editable name when the press came from an
 * edition page.
 */
export async function startIssueDownload(
  app: App,
  { volumeName, editionName, issue, label, indexId, fetchPage = fetchSourcePage }: {
    volumeName: string | null
    editionName: string
    issue: CvVolumeIssue
    /** What the queue shows for this row; the url stands in when there is no name. */
    label?: string
    /** The scraped row the user picked, when they picked one. Skips the derivation. */
    indexId?: number
    /** Injected so tests never touch the network. */
    fetchPage?: (url: string) => Promise<string>
  },
): Promise<IssueDownloadResult> {
  // A chosen row is still looked up, so a rescrape between the dialog opening and the
  // press refuses rather than downloading whatever now holds that id.
  const chosenId = indexId ?? findMatchForIssue(app.db, volumeName, issue)?.indexId
  if (chosenId == null) return { ok: false, code: 409, reason: 'no-match', error: 'no unique match for that issue' }

  const row = comicIndexById(app.db, chosenId)
  if (!row) {
    return indexId != null
      ? { ok: false, code: 409, reason: 'no-match', error: 'that release is no longer in the index' }
      : { ok: false, code: 409, reason: 'no-match', error: 'no unique match for that issue' }
  }

  let url: string | null = null
  try {
    url = parseDownloadLink(await fetchPage(row.url), row.url)
  } catch {
    return { ok: false, code: 502, reason: 'unreadable', error: 'could not read that post' }
  }
  if (!url) return { ok: false, code: 404, reason: 'no-link', error: 'no download link on that post' }

  // row.url is the post the link was parsed out of, and it is kept rather than dropped
  // here: if the file host answers with a bot check, this is the page you can open.
  const res = app.downloader.enqueue({
    url, edition: editionName, issueId: issue.id, label: label || url, postUrl: row.url,
  })
  if (!res.queued) {
    return {
      ok: false, code: 409, reason: 'duplicate',
      error: 'that issue is already queued', entry: res.duplicate,
    }
  }
  return { ok: true, entry: res.entry }
}
