import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiVolumeIssue, ApiBook } from '../api'
import { useDownload } from '../lib/useDownload'
import { findIssueSeed } from '../lib/findIssueSeed'
import { useFindRelease } from '../lib/useFindRelease'
import CoverTile from './CoverTile'
import MissingIssueTile from './MissingIssueTile'
import IssueUploadAction from './IssueUploadAction'

/**
 * One issue of the run: the comic if you have it, otherwise its place in the run and a
 * way to fill it.
 *
 * A missing issue shows no art - a cover is a spoiler for a comic you have not read -
 * and offers `Get` only when exactly one scraped release can be this issue. Anything
 * less certain offers `Find`, which opens the search with the series and year filled
 * in so you choose by eye. The button never guesses; that is the whole point of it.
 *
 * Lives here rather than inside the volume page because two pages draw a run now: the
 * edition page, and a volume shelf that holds the volume's own issues as well as
 * collections of them.
 */
export default function VolumeIssueTile({ issue, book, editionId, editionName, seriesName }: {
  issue: ApiVolumeIssue
  book?: ApiBook
  editionId: string
  /** What the run is called, which is where a comic uploaded into a gap is filed. */
  editionName: string
  seriesName: string
}) {
  const qc = useQueryClient()
  const label = `#${issue.number ?? '?'}`
  const { liveByIssue } = useDownload()

  const get = useMutation({
    mutationFn: () => api.downloadMissingIssue(editionId, issue.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
  })

  // The tile says "#3"; the dialog floats over the page and has to say which run's #3.
  const find = useFindRelease({
    gapLabel: `${editionName} ${label}`,
    seed: findIssueSeed(seriesName, issue.coverDate),
    onDownload: (indexId) => api.downloadMissingIssue(editionId, issue.id, indexId),
  })

  if (issue.owned && issue.bookId != null) {
    return (
      <CoverTile
        to={`/edition/${editionId}?view=carousel&issue=book-${issue.bookId}`}
        img={`/api/books/${issue.bookId}/thumbnail`}
        title={book?.title || issue.name || label}
        subtitle={label}
        readState={book?.readState}
        percent={book?.percent}
      />
    )
  }

  return (
    <>
      <MissingIssueTile
        label={label}
        siteUrl={issue.siteUrl}
        hasMatch={issue.match != null}
        matchTitle={issue.match?.title}
        onFind={find.onFind}
        onGet={() => get.mutate()}
        pending={get.isPending}
        failed={get.isError}
        queued={liveByIssue.has(issue.id)}
        upload={<IssueUploadAction editionName={editionName} issueId={issue.id} label={label} />}
      />
      {find.dialog}
    </>
  )
}
