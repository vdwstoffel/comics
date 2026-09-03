import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiArcIssue } from '../api'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'

/**
 * An issue in the arc. Yours shows its own cover and opens in the library; one you do not
 * have shows no art at all — a cover is a spoiler for a comic you have not read — but keeps
 * its place in the run and stays clickable through to Comic Vine.
 */
function ArcIssue({ issue }: { issue: ApiArcIssue }) {
  const title = issue.name || `Issue ${issue.id}`
  if (issue.owned && issue.bookId != null) {
    return <CoverTile to={`/book/${issue.bookId}`} img={`/api/books/${issue.bookId}/thumbnail`} title={title} />
  }
  return <CoverTile href={issue.siteUrl} title={title} subtitle="Missing" />
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
