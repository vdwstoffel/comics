import { useState, useRef } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { useBackLink } from '../lib/backOrigin'
import type { ApiArcIssue } from '../api'
import CoverTile from '../components/CoverTile'
import MissingIssueTile from '../components/MissingIssueTile'
import LibraryRail from '../components/LibraryRail'
import { useDownload } from '../lib/useDownload'
import { arcIssueLabel } from '../lib/arcIssueLabel'
import FollowButton from '../components/FollowButton'
import ArcReorderList from '../components/ArcReorderList'

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
  const title = arcIssueLabel(issue)

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
  // Set just before a refetch and consumed by it, so pressing Refresh bypasses the
  // server's day-long cache while an ordinary render does not. It stays out of the query
  // key deliberately: a forced read and a normal one are the same data, not two caches.
  // The volume page and This week carry the same mechanism for the same reason.
  const forceRefresh = useRef(false)
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ['arc', arcName],
    queryFn: () => {
      const force = forceRefresh.current
      forceRefresh.current = false
      return api.getArc(arcName, force)
    },
    retry: false,
  })
  const refreshArc = () => {
    forceRefresh.current = true
    void refetch()
  }

  const [reordering, setReordering] = useState(false)
  const qc = useQueryClient()

  // The run comes back from the server rather than being patched in locally: the order is
  // applied where the "Part 2 of 6" line also reads it, so a refetch is what keeps the two
  // telling the same story.
  const save = useMutation({
    mutationFn: (issueIds: number[]) => api.saveArcOrder(arcName, issueIds),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['arc', arcName] })
      setReordering(false)
    },
  })

  const reset = useMutation({
    mutationFn: () => api.resetArcOrder(arcName),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['arc', arcName] }),
  })

  const arc = data?.arc
  const owned = arc?.issues.filter((i) => i.owned).length ?? 0
  // An arc is reached from the arcs shelf, the follows shelf, or an issue inside a run.
  const back = useBackLink('/arcs', 'All story arcs')

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <Link to={back.to} onClick={back.onClick} className="back-link">← {back.label}</Link>
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
            {!reordering && (
              <div className="arc-detail__actions">
                {/* The state leads, so the buttons below it read as what to do about it. */}
                {data?.ordered && <span className="arc-detail__ordered">In your order</span>}
                {/*
                  A forced read Comic Vine would not answer falls back to the run we
                  already held, which redraws identically. Without this the button would
                  look like it had done nothing at all.
                */}
                {data?.stale && <span>Could not reach Comic Vine</span>}
                <FollowButton target={{ kind: 'arc', name: arcName }} refId={data?.arcId ?? null} />
                <button type="button" className="btn btn-ghost" onClick={() => setReordering(true)}>Reorder</button>
                {/* Only worth offering once there is an arrangement to undo. */}
                {data?.ordered && (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={reset.isPending}
                    onClick={() => reset.mutate()}
                  >
                    Reset to Comic Vine order
                  </button>
                )}
                {/*
                  The run is cached for a day, and an arc still being published gains
                  issues inside that day. This asks Comic Vine again without waiting the
                  day out. Inside `!reordering` with the rest: refreshing mid-drag would
                  pull the list out from under you.
                */}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={isFetching}
                  onClick={refreshArc}
                >
                  {isFetching ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>
            )}
            {reordering ? (
              <ArcReorderList
                issues={arc.issues}
                saving={save.isPending}
                onSave={(issueIds) => save.mutate(issueIds)}
                onCancel={() => setReordering(false)}
              />
            ) : (
              <div className="tile-grid arc-issue-grid">
                {arc.issues.map((issue) => <ArcIssue key={issue.id} issue={issue} />)}
              </div>
            )}
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
