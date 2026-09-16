import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiReleaseIssue } from '../api'
import CoverTile from '../components/CoverTile'
import MissingIssueTile from '../components/MissingIssueTile'
import { useDownload } from '../lib/useDownload'

/** `2026-09-09` -> `Wednesday 9 September 2026`. Parsed as UTC: the day has no timezone. */
function writeOutDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

function label(issue: ApiReleaseIssue): string {
  const series = issue.volumeName ?? 'Unknown series'
  return issue.number ? `${series} #${issue.number}` : series
}

/**
 * One comic out this week.
 *
 * Cover art is shown here even though you do not own most of these, which is the opposite
 * of what the arc page does - there, a cover is a spoiler for a comic you have not read.
 * The exception is deliberate: every issue on a releases page is one you have not read,
 * so that rule would blank the whole page, and a shop window with no art is not a shop
 * window. The rule still stands where it was written; this page is not a reading list.
 */
function ReleaseIssue({ issue }: { issue: ApiReleaseIssue }) {
  const qc = useQueryClient()
  const text = label(issue)
  const { liveByIssue } = useDownload()

  const get = useMutation({
    mutationFn: () => api.downloadRelease(issue.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download'] }),
  })

  if (issue.owned && issue.bookId != null) {
    return (
      <CoverTile
        to={`/book/${issue.bookId}`}
        img={`/api/books/${issue.bookId}/thumbnail`}
        title={text}
        subtitle="In your library"
      />
    )
  }

  const findParams = new URLSearchParams({ q: issue.volumeName ?? '' })
  // Comic Vine's cover date runs ahead of the scraped release year (Venom #251 has a
  // 2026-01 cover date but is posted as "Venom #251 (2025)" - see issueMatch's
  // YEAR_SLACK), so a floor set to the cover year exactly would filter out the very
  // row Find is meant to surface. Back it off by the same one year the matching rule
  // tolerates - the seed the edition page's Find already uses, and the same reason.
  // (Not importing YEAR_SLACK here: src/ never reaches into server/.)
  const coverYear = issue.coverDate ? Number(String(issue.coverDate).slice(0, 4)) : NaN
  if (Number.isInteger(coverYear)) findParams.set('yearFrom', String(coverYear - 1))

  return (
    <MissingIssueTile
      label={text}
      siteUrl={issue.siteUrl}
      coverUrl={issue.coverUrl}
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

export default function Releases() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['releases'],
    queryFn: api.getReleases,
    retry: false,
  })

  return (
    <>
      <h1 className="page-title">Latest releases</h1>
      {isLoading && <p>Loading…</p>}
      {isError && <p>{"Couldn't load the latest releases."}</p>}
      {data && (
        <>
          <p className="arc-detail__meta">{writeOutDay(data.day)}</p>
          {data.unavailable && <p>We could not reach Comic Vine, so there is nothing to show yet.</p>}
          {/*
            `stale` has two producers and the line has to be true for both: a cached day
            served after Comic Vine failed, and a *fresh* fetch of the *correct* day whose
            publisher lookup came back short (see routes/releases.ts). "Showing what we
            last saw" was a lie for the second - and worst in its empty shape, where the
            lookup lost every Marvel and DC volume and the page would otherwise be a
            correct date above nothing at all, explaining neither.
          */}
          {data.stale && (
            <p className="arc-detail__meta">
              This may be incomplete — Comic Vine did not answer in full.
            </p>
          )}
          {data.publishers.map((publisher) => (
            <section key={publisher.name}>
              <h2 className="page-title">{publisher.name}</h2>
              <div className="tile-grid arc-issue-grid">
                {publisher.issues.map((issue) => <ReleaseIssue key={issue.id} issue={issue} />)}
              </div>
            </section>
          ))}
        </>
      )}
    </>
  )
}
