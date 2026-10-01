import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiArcIssue } from '../api'
import CoverTile from '../components/CoverTile'
import MissingIssueTile from '../components/MissingIssueTile'
import LibraryRail from '../components/LibraryRail'
import { useDownload } from '../lib/useDownload'

/**
 * What to call an issue. Comic Vine gives most of them no story title at all, so the series
 * and number carry the tile; the bare id is the last resort, for when the issue lookup that
 * supplies those failed.
 */
function label(issue: ApiArcIssue): string {
  if (issue.volumeName) return issue.number ? `${issue.volumeName} #${issue.number}` : issue.volumeName
  return issue.name || `Issue ${issue.id}`
}

/**
 * An issue in the arc. Yours shows its own cover and opens in the library; one you do not
 * have shows no art at all — a cover is a spoiler for a comic you have not read — but keeps
 * its place in the run, stays clickable through to Comic Vine, and offers to fill the gap.
 *
 * The offer is the edition page's, in the same words: `Get` when exactly one scraped row
 * can be this issue, `Find` when anything less certain. Where the file lands is the
 * server's decision alone — an arc spans the series it is named for and every volume that
 * tied in, so there is no one edition this page could name.
 */
function ArcIssue({ issue }: { issue: ApiArcIssue }) {
  const qc = useQueryClient()
  const { liveByIssue } = useDownload()
  const title = label(issue)

  const get = useMutation({
    mutationFn: () => api.downloadArcIssue(issue.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
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

  // Find searches for the issue's OWN series, never the arc's name: an arc is not a series
  // and the index holds nothing under it. Same one-year floor the edition page uses, for
  // the same reason — Comic Vine's cover date runs ahead of the scraped release year.
  const findParams = new URLSearchParams({ q: issue.volumeName ?? title })
  const coverYear = issue.coverDate ? Number(String(issue.coverDate).slice(0, 4)) : NaN
  if (Number.isInteger(coverYear)) findParams.set('yearFrom', String(coverYear - 1))

  return (
    <MissingIssueTile
      label={title}
      siteUrl={issue.siteUrl}
      hasMatch={issue.match != null}
      matchTitle={issue.match?.title}
      findTo={`/search?${findParams}`}
      onGet={() => get.mutate()}
      pending={get.isPending}
      failed={get.isError}
      queued={liveByIssue.has(issue.id)}
    />
  )
}

export default function Arc() {
  const { name } = useParams()
  const arcName = decodeURIComponent(name ?? '')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['arc', arcName],
    queryFn: () => api.getArc(arcName),
    retry: false,
  })

  const arc = data?.arc
  const owned = arc?.issues.filter((i) => i.owned).length ?? 0

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <Link to="/arcs" className="back-link">← All story arcs</Link>
        {isLoading && <p>Loading…</p>}
        {isError && <p>{"Couldn't load this story arc."}</p>}
        {arc && (
          <>
            <h1 className="page-title">{arc.name || arcName}</h1>
            <p className="arc-detail__meta">
              {[arc.publisher, `${owned} of ${arc.issues.length} issues in your library`]
                .filter(Boolean).join(' · ')}
            </p>
            {arc.deck && <p className="arc-detail__deck">{arc.deck}</p>}
            <div className="tile-grid arc-issue-grid">
              {arc.issues.map((issue) => <ArcIssue key={issue.id} issue={issue} />)}
            </div>
            {arc.siteUrl && (
              <a className="character-card__link" href={arc.siteUrl} target="_blank" rel="noreferrer">
                See this arc on Comic Vine ↗
              </a>
            )}
          </>
        )}
      </main>
    </>
  )
}
