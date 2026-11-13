import type { ApiArcIssue } from '../api'
import CoverTile from './CoverTile'
import MissingIssueTile from './MissingIssueTile'
import { useDownload } from '../lib/useDownload'
import { useGetIssue } from '../lib/useGetIssue'
import { arcIssueLabel } from '../lib/arcIssueLabel'
import { findIssueSeed } from '../lib/findIssueSeed'
import { useFindRelease } from '../lib/useFindRelease'

interface StoryIssueTileProps {
  issue: ApiArcIssue
  /** Get: the one scraped row the server is sure of. */
  get: () => Promise<unknown>
  /** Find: the row you picked by eye. */
  download: (indexId: number) => Promise<unknown>
}

/**
 * An issue in a story that crosses runs - an arc, or a reading list. Yours shows its own
 * cover and opens in the library; one you do not have shows no art at all — a cover is a
 * spoiler for a comic you have not read — but keeps its place in the run, stays clickable
 * through to Comic Vine, and offers to fill the gap.
 *
 * The offer is the edition page's, in the same words: `Get` when exactly one scraped row
 * can be this issue, `Find` when anything less certain. Where the file lands is the
 * server's decision alone — a story spans the series it is named for and every volume
 * that tied in, so there is no one edition this page could name.
 */
export default function StoryIssueTile({ issue, get: start, download }: StoryIssueTileProps) {
  const { liveByIssue } = useDownload()
  const title = arcIssueLabel(issue)

  const get = useGetIssue(start)

  // Find searches for the issue's OWN series, never the story's name: an arc or a list is
  // not a series and the index holds nothing under it. The year floor and its reasoning
  // live in findIssueSeed, shared with the edition page.
  // Above the early return: a gap that arrives redraws in place as the comic, and a hook
  // skipped on that render takes the whole page down.
  const find = useFindRelease({
    gapLabel: title,
    seed: findIssueSeed(issue.volumeName ?? title, issue.coverDate),
    onDownload: download,
  })

  if (issue.owned && issue.bookId != null) {
    return (
      <CoverTile
        to={`/book/${issue.bookId}`}
        img={`/api/books/${issue.bookId}/thumbnail`}
        title={title}
        // The story title, where there is one, sits under the series rather than replacing it.
        subtitle={issue.name && issue.name !== title ? issue.name : undefined}
        readState={issue.readState}
        percent={issue.percent}
      />
    )
  }

  return (
    <>
      <MissingIssueTile
        label={title}
        siteUrl={issue.siteUrl}
        hasMatch={issue.match != null}
        matchTitle={issue.match?.title}
        onFind={find.onFind}
        onGet={() => get.mutate()}
        pending={get.isPending}
        failed={get.isError}
        queued={liveByIssue.has(issue.id)}
      />
      {find.dialog}
    </>
  )
}
