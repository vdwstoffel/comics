import { startIssueDownload, issueLabel } from './issueDownload.js'
import { findMatchForIssue } from './issueMatching.js'
import { fetchSourcePage } from '../lib/comicIndexSource.js'
import type { CvVolumeIssue } from '../lib/comicvine.js'
import type { App, Edition } from '../types.js'

/**
 * The volumes currently being walked, so a second press cannot start a second walk over
 * the same run - it would fetch every post again only to be told each one is already
 * queued. Keyed by edition, because two different volumes may well be filling at once.
 */
const walking = new Map<number, Promise<void>>()

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Resolves when no volume is being walked. Tests await it; nothing else needs it. */
export async function bulkIssueDownloadsIdle(): Promise<void> {
  while (walking.size > 0) await Promise.all([...walking.values()])
}

/**
 * Which issues of this run "Get all" would take: the ones you do not have, that exactly
 * one scraped release can be.
 *
 * This is the rule that drew each tile's Get button, applied again on the server. A page
 * rendered before a rescrape could otherwise ask for a row that has since moved or become
 * ambiguous, and a download nobody checked is the one that files the wrong comic.
 */
export function missingMatchedIssues(
  app: App,
  { edition, issues, owned }: { edition: Edition; issues: CvVolumeIssue[]; owned: Set<number> },
): CvVolumeIssue[] {
  return issues.filter((issue) =>
    !owned.has(issue.id) && findMatchForIssue(app.db, edition.cvName, issue) !== null)
}

/**
 * Queue every gap in a volume that the index can fill, in the background.
 *
 * One issue at a time, and three seconds apart, deliberately so: each step fetches a post
 * from someone else's site, and what comes out of it joins a queue that is already paced
 * by its own concurrency setting. Downloading thirty comics faster is not worth thirty
 * simultaneous requests to the site that hosts them, nor thirty in a burst - a walk that
 * looks like a human reading posts is one the site has no reason to shut out.
 *
 * Every issue goes through the same `startIssueDownload` a single Get does, so the match
 * is decided per issue at the moment it is queued rather than in bulk beforehand. An issue
 * whose post cannot be read, or whose match has become ambiguous in the interval, is
 * skipped: it stays a Get tile, and the twenty-eight behind it still get queued.
 *
 * Returns synchronously with what it is about to attempt - the button that sent the press
 * is showing a count, and a reader who pressed 29 should be told 29 rather than waiting
 * out the walk to hear it.
 */
export function queueMissingIssues(
  app: App,
  { edition, issues, fetchPage = fetchSourcePage, delayMs = 3000 }: {
    edition: Edition
    issues: CvVolumeIssue[]
    /** Injected so tests never touch the network. */
    fetchPage?: (url: string) => Promise<string>
    /** The pause between issues. Injected as 0 by tests, which have no site to spare. */
    delayMs?: number
  },
): { queued: number } | { already: true } {
  if (walking.has(edition.id)) return { already: true }
  if (issues.length === 0) return { queued: 0 }

  const walk = (async () => {
    for (const [i, issue] of issues.entries()) {
      try {
        await startIssueDownload(app, {
          volumeName: edition.cvName,
          editionName: edition.name,
          issue,
          label: issueLabel(edition.cvName, issue.number),
          fetchPage,
        })
      } catch {
        // startIssueDownload reports its own refusals; this is for anything it did not
        // anticipate. One issue must never be able to end the walk.
      }
      // After the attempt rather than before it, because a post that failed to read was
      // still a request to the site. Nothing waits behind the last issue.
      if (delayMs && i < issues.length - 1) await sleep(delayMs)
    }
  })().finally(() => { walking.delete(edition.id) })

  walking.set(edition.id, walk)
  return { queued: issues.length }
}
