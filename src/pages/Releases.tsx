import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import type { ApiReleaseIssue } from '../api'
import CoverTile from '../components/CoverTile'
import MissingIssueTile from '../components/MissingIssueTile'
import RunningTable from '../components/RunningTable'
import PublisherTabs from '../components/PublisherTabs'
import { usePublisher } from '../lib/usePublisher'
import { writeOutDay } from '../lib/releaseWeek'
import { useUpcoming } from '../lib/useUpcoming'
import { useDownload } from '../lib/useDownload'

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

/** This Wednesday's Marvel and DC issues — the tab this page started as. */
function ThisWeek() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['releases'],
    queryFn: api.getReleases,
    retry: false,
  })

  const names = data?.publishers.map((p) => p.name) ?? []
  const { current, select } = usePublisher(names)
  const shown = data?.publishers.find((p) => p.name === current)

  return (
    <>
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
          {/*
            The strip sits below the day and its warnings: those describe the whole
            Wednesday, not whichever publisher you happen to be reading. A day with no
            publishers at all - a Comic Vine failure - shows them and no strip.
          */}
          {current && <PublisherTabs names={names} current={current} onSelect={select} />}
          {shown && (shown.issues.length === 0
            ? (
              <p className="arc-detail__meta">
                {`Nothing from ${shown.name} this Wednesday.`}
              </p>
            )
            : (
              <div className="tile-grid arc-issue-grid">
                {shown.issues.map((issue) => <ReleaseIssue key={issue.id} issue={issue} />)}
              </div>
            ))}
        </>
      )}
    </>
  )
}

/**
 * Everything Marvel and DC are publishing right now, from Wikipedia.
 *
 * Nothing here touches Comic Vine, so this tab works on a fresh install with no key
 * entered — unlike the weekly tab, which cannot answer at all without one.
 */
function CurrentlyRunning() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['releases-running'],
    queryFn: api.getRunning,
    retry: false,
    // The server caches nothing: every request re-reads both Wikipedia pages. React
    // Query's defaults would refetch on each mount *and* each window refocus, so reading
    // Wikipedia twice every time you alt-tab back. Five minutes keeps the tab fresh per
    // visit without that. Set on this query rather than on the QueryClient — a default
    // there would quietly change how every other query in the app refetches.
    staleTime: 5 * 60_000,
  })

  const failed = data?.failed ?? []
  const publishers = data?.publishers ?? []
  const names = publishers.map((p) => p.name)
  const { current, select } = usePublisher(names)
  const shown = publishers.find((p) => p.name === current)

  return (
    <>
      {isLoading && <p>Loading…</p>}
      {isError && <p>{"Couldn't reach Wikipedia, so there is nothing to show here yet."}</p>}
      {current && shown && (
        <>
          <PublisherTabs names={names} current={current} onSelect={select} />
          {/*
            A publisher we could not read keeps its tab and explains itself inside it.
            Dropping the tab would leave you hunting for where DC went, and an empty table
            under its name would read as "DC has stopped publishing", which it never means.
          */}
          {failed.includes(shown.name)
            ? (
              <p className="arc-detail__meta">
                {`Couldn't read the Wikipedia list for ${shown.name}.`}
              </p>
            )
            : <RunningTable publisher={shown} />}
        </>
      )}
    </>
  )
}

/**
 * What Marvel has announced for the coming weeks, from Marvel's own calendar.
 *
 * Solicitations, not facts: a date can slip and an issue can be cancelled, so the server
 * never holds a week for long. Nothing here offers a Get - the comic does not exist yet -
 * which is why these tiles are CoverTile directly rather than MissingIssueTile.
 */
function Upcoming() {
  const { data, isLoading, isError } = useUpcoming()

  const publishers = data?.publishers ?? []
  const names = publishers.map((p) => p.name)
  const { current, select } = usePublisher(names)
  const shown = publishers.find((p) => p.name === current)
  const last = shown?.weeks[shown.weeks.length - 1]

  return (
    <>
      {isLoading && <p>Loading…</p>}
      {isError && <p>{"Couldn't reach Marvel, so there is nothing to show here yet."}</p>}
      {current && shown && (
        <>
          <PublisherTabs names={names} current={current} onSelect={select} />
          {shown.unsupported ? (
            <p className="arc-detail__meta">
              {`We don't have a source for upcoming ${shown.name} releases yet, so this tab only covers Marvel for now.`}
            </p>
          ) : shown.unavailable ? (
            <p className="arc-detail__meta">
              {`Couldn't read ${shown.name}'s release calendar.`}
            </p>
          ) : (
            <>
              {data?.staleWeeks?.length ? (
                <p className="arc-detail__meta">
                  Some weeks may be out of date — Marvel did not answer in full.
                </p>
              ) : null}
              {shown.weeks.map((w) => (
                <section key={w.week}>
                  <h2 className="arc-detail__meta">{writeOutDay(w.week)}</h2>
                  {w.issues.length === 0 ? (
                    <p className="arc-detail__meta">Nothing announced for this week.</p>
                  ) : (
                    <div className="tile-grid arc-issue-grid">
                      {w.issues.map((issue) => (
                        <CoverTile
                          key={issue.sourceId}
                          href={issue.siteUrl}
                          img={issue.coverUrl ?? undefined}
                          title={issue.headline}
                          subtitle={issue.creators ?? undefined}
                        />
                      ))}
                    </div>
                  )}
                </section>
              ))}
              {last && (
                <p className="arc-detail__meta">
                  {`Marvel hasn't announced anything beyond ${writeOutDay(last.week)} yet.`}
                </p>
              )}
            </>
          )}
        </>
      )}
    </>
  )
}

const TABS = [
  { id: 'week', label: 'This week' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'running', label: 'Currently running' },
] as const

export default function Releases() {
  const [params, setParams] = useSearchParams()
  // The tab lives in the url so a reload, or a back press, does not drop you onto the
  // covers when you were reading the table.
  const raw = params.get('tab')
  const tab = raw === 'running' || raw === 'upcoming' ? raw : 'week'

  return (
    <>
      <h1 className="page-title">Latest releases</h1>
      <div className="tabs" role="tablist" aria-label="Releases view">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'tab tab--on' : 'tab'}
            // Written through the previous params, not over them: replacing the whole
            // query string here dropped `pub`, so switching view silently sent you back
            // to Marvel even though you were reading DC.
            onClick={() => setParams((prev) => {
              const next = new URLSearchParams(prev)
              if (t.id === 'week') next.delete('tab')
              else next.set('tab', t.id)
              return next
            }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'week' && <ThisWeek />}
      {tab === 'upcoming' && <Upcoming />}
      {tab === 'running' && <CurrentlyRunning />}
    </>
  )
}
