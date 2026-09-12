import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type {
  ComicIndexGroup, ComicIndexQuery, CvVolumeMatch, IssueRun, ReleaseKind, ScrapeStatus,
} from '../api'

const PAGE_SIZE = 50
const DEBOUNCE_MS = 250
const POLL_MS = 1000

/** Below this a series is short enough to read whole; splitting it is just more clicks. */
const KIND_SPLIT_MIN = 12
const KIND_ORDER: ReleaseKind[] = ['issue', 'miniseries', 'bundle', 'collection', 'other']
const KIND_LABEL: Record<ReleaseKind, string> = {
  issue: 'Issues', miniseries: 'Miniseries', bundle: 'Bundles',
  collection: 'Collections', other: 'Specials',
}

function kindsPresent(group: ComicIndexGroup): ReleaseKind[] {
  return KIND_ORDER.filter((k) => (group.kinds[k] ?? 0) > 0)
}

/**
 * The kinds worth listing beside the runs. When runs are on offer they already account
 * for every issue, so listing "Issues" as well would show each one twice.
 */
function kindsBesideRuns(group: ComicIndexGroup): ReleaseKind[] {
  const present = kindsPresent(group)
  return group.runs.length ? present.filter((k) => k !== 'issue') : present
}

/**
 * Worth breaking up when there is enough in it AND there is more than one heading to
 * break it into — either several kinds, or several runs of the same kind.
 */
function splitByKind(group: ComicIndexGroup): boolean {
  const headings = kindsBesideRuns(group).length + group.runs.length
  return group.total > KIND_SPLIT_MIN && headings > 1
}

/** What a row's download button is doing, threaded down to the rows inside a series. */
export interface DownloadControl {
  start: (id: number) => void
  pendingId: number | null
  error: { id: number; message: string } | null
}

function fullYear(value: string): number | undefined {
  return /^\d{4}$/.test(value.trim()) ? Number(value) : undefined
}

export default function SearchComics() {
  // Arriving from an edition carries its series and first year, so the page opens on
  // results rather than a blank box. Both the raw and the committed values are seeded,
  // which is what saves the first search from waiting out a debounce tick.
  const [urlParams] = useSearchParams()
  const seededQuery = urlParams.get('q')?.trim() ?? ''
  const seededYearFrom = urlParams.get('yearFrom')?.trim() ?? ''

  const [input, setInput] = useState(seededQuery)
  const [query, setQuery] = useState(seededQuery)
  const [category, setCategory] = useState<string | null>(null)
  const [yearInput, setYearInput] = useState({ from: seededYearFrom, to: '' })
  const [years, setYears] = useState<{ from?: number; to?: number }>({
    from: fullYear(seededYearFrom),
  })

  // Debounce so a fetch fires per pause, not per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(input.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [input])

  // A bound only counts once it is a full four digits, so typing "2", "20", "201" on
  // the way to "2015" does not fire searches for years 2, 20 and 201.
  useEffect(() => {
    const timer = setTimeout(() => setYears({
      from: fullYear(yearInput.from),
      to: fullYear(yearInput.to),
    }), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [yearInput])

  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Which row's link lookup failed, and why. Held per row so the message sits under the
  // result you clicked rather than floating at the top of the page.
  const [linkError, setLinkError] = useState<{ id: number; message: string } | null>(null)

  // A post page is only read when you ask for it: the index stores where a comic lives,
  // not the link behind its download button. Finding it here rather than on the upload
  // page keeps the wait and any failure on the button that was actually clicked.
  const getLink = useMutation({
    mutationFn: (id: number) => api.getComicIndexDownloadLink(id),
    onSuccess: (d) => navigate(`/upload?url=${encodeURIComponent(d.url)}`),
    onError: (err: Error, id) => setLinkError({
      id,
      message: err.message === '404'
        ? 'No download link on that post — open it and try a mirror.'
        : 'Could not read that post. Try again.',
    }),
  })

  // Poll only while a run is in flight, so an idle page makes one request and stops.
  const { data: scrape } = useQuery({
    queryKey: ['comic-index-scrape'],
    queryFn: api.getScrapeStatus,
    refetchInterval: (q) => (q.state.data?.running ? POLL_MS : false),
  })
  const running = scrape?.running ?? false

  const startScrape = useMutation({
    mutationFn: api.startScrape,
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['comic-index-scrape'] }),
  })

  // When a run ends, pull in whatever it added.
  const wasRunning = useRef(false)
  useEffect(() => {
    if (wasRunning.current && !running) {
      queryClient.invalidateQueries({ queryKey: ['comic-index'] })
      queryClient.invalidateQueries({ queryKey: ['comic-index-categories'] })
    }
    wasRunning.current = running
  }, [running, queryClient])

  const { data: categoryData } = useQuery({
    queryKey: ['comic-index-categories'],
    queryFn: api.getComicIndexCategories,
  })
  const categories = categoryData?.categories ?? []
  const indexed = categoryData?.indexed ?? 0

  // Everything that decides which rows match, in one object: the group list is keyed on
  // it, and each opened series re-sends it so its rows come from the same search.
  const filters: ComicIndexQuery = {
    q: query,
    category: category ?? undefined,
    yearFrom: years.from,
    yearTo: years.to,
  }

  const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useInfiniteQuery({
      queryKey: ['comic-index', query, category, years.from, years.to],
      queryFn: ({ pageParam }) =>
        api.groupComicIndex({ ...filters, limit: PAGE_SIZE, offset: pageParam }),
      initialPageParam: 0,
      // The window counts series, not comics: another page means more headings.
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((n, page) => n + page.groups.length, 0)
        return loaded < lastPage.totalGroups ? loaded : undefined
      },
      enabled: query.length > 0,
    })

  const groups = data?.pages.flatMap((page) => page.groups) ?? []
  const totalGroups = data?.pages[0]?.totalGroups ?? 0
  const totalResults = data?.pages[0]?.totalResults ?? 0
  const searching = query.length > 0

  // Which headings are open, by group key and by `key|kind`. A new search invalidates
  // every one of them, so it starts closed rather than half-open on the last search.
  const [open, setOpen] = useState<Set<string>>(new Set())
  useEffect(() => setOpen(new Set()), [query, category, years.from, years.to])
  const toggle = (key: string) => setOpen((prev) => {
    const next = new Set(prev)
    if (!next.delete(key)) next.add(key)
    return next
  })

  const download: DownloadControl = {
    start: (id) => { setLinkError(null); getLink.mutate(id) },
    pendingId: getLink.isPending ? getLink.variables ?? null : null,
    error: linkError,
  }

  return (
    <div className="search-comics">
      <h1 className="page-title">Search comics</h1>
      <p className="page-subtitle">
        {indexed ? `${indexed.toLocaleString()} titles indexed` : 'Nothing indexed yet'}
      </p>

      <div className="search-comics__scrape">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={running || startScrape.isPending}
          onClick={() => startScrape.mutate('quick')}
        >
          Check for new
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={running || startScrape.isPending}
          onClick={() => startScrape.mutate('full')}
        >
          Full scrape
        </button>
        {scrape && <ScrapeProgress status={scrape} />}
      </div>

      <input
        type="search"
        className="search-comics__input"
        placeholder="Search by name…"
        aria-label="Search comics"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        autoFocus
      />

      {categories.length > 0 && (
        <div className="chip-row search-comics__filters">
          <button
            type="button"
            className={`chip search-comics__filter${category === null ? ' search-comics__filter--on' : ''}`}
            onClick={() => setCategory(null)}
          >
            All
          </button>
          {categories.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`chip search-comics__filter${category === c.name ? ' search-comics__filter--on' : ''}`}
              onClick={() => setCategory(category === c.name ? null : c.name)}
            >
              {c.name} <span className="search-comics__filter-count">{c.count.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}

      <div className="search-comics__years">
        <label className="search-comics__year-field">
          <span>Year from</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="1933"
            value={yearInput.from}
            onChange={(e) => setYearInput((y) => ({ ...y, from: e.target.value }))}
          />
        </label>
        <label className="search-comics__year-field">
          <span>Year to</span>
          <input
            type="number"
            inputMode="numeric"
            placeholder="2027"
            value={yearInput.to}
            onChange={(e) => setYearInput((y) => ({ ...y, to: e.target.value }))}
          />
        </label>
        {(yearInput.from || yearInput.to) && (
          <button
            type="button"
            className="btn btn-ghost search-comics__year-clear"
            onClick={() => setYearInput({ from: '', to: '' })}
          >
            Clear years
          </button>
        )}
      </div>

      {!searching && <p className="search-comics__hint">Type to search the index.</p>}

      {error && <p className="search-comics__error">Search failed. Try again.</p>}

      {searching && !error && (
        <>
          <p className="search-comics__count">
            {isFetching && !isFetchingNextPage && groups.length === 0
              ? 'Searching…'
              : totalResults === 0
                ? 'No matches'
                : `${totalResults.toLocaleString()} matches in ${totalGroups.toLocaleString()} series`}
          </p>

          <ul className="search-comics__groups">
            {groups.map((g) => (
              <GroupRow
                key={g.key}
                group={g}
                filters={filters}
                open={open}
                toggle={toggle}
                download={download}
              />
            ))}
          </ul>

          {hasNextPage && (
            <button
              type="button"
              className="btn btn-ghost search-comics__more"
              onClick={() => fetchNextPage()}
              disabled={isFetchingNextPage}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}

function ScrapeProgress({ status }: { status: ScrapeStatus }) {
  const counts = `${status.inserted} new, ${status.updated} updated`

  if (status.error) {
    return <span className="search-comics__scrape-status search-comics__error">{status.error}</span>
  }
  if (status.running) {
    return (
      <span className="search-comics__scrape-status">
        page {status.page} of {status.totalPages} — {counts}
      </span>
    )
  }
  if (status.finishedAt) {
    return <span className="search-comics__scrape-status">Last run: {counts}</span>
  }
  return null
}


/** One series heading, and whatever it is showing underneath. */
function GroupRow({ group, filters, open, toggle, download }: {
  group: ComicIndexGroup
  filters: ComicIndexQuery
  open: Set<string>
  toggle: (key: string) => void
  download: DownloadControl
}) {
  const isOpen = open.has(group.key)
  return (
    <li className="search-comics__group">
      <button
        type="button"
        className="search-comics__group-header"
        aria-expanded={isOpen}
        onClick={() => toggle(group.key)}
      >
        <span className="search-comics__caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        <span className="search-comics__group-name">{group.name}</span>
        <span className="search-comics__group-count">{group.total.toLocaleString()}</span>
      </button>

      {isOpen && <ComicVineLookup series={group.name} />}

      {isOpen && (splitByKind(group)
        ? (
          <ul className="search-comics__kinds">
            {/* Runs first: the issues are what you are usually after, newest at the top. */}
            {group.runs.map((run) => (
              <SubHeading
                key={run.key}
                id={`${group.key}|run|${run.key}`}
                label={run.label}
                count={run.total}
                open={open}
                toggle={toggle}
              >
                <ItemList filters={filters} series={group.key} run={run.key} download={download} />
              </SubHeading>
            ))}
            {kindsBesideRuns(group).map((kind) => (
              <SubHeading
                key={kind}
                id={`${group.key}|${kind}`}
                label={KIND_LABEL[kind]}
                count={group.kinds[kind]}
                open={open}
                toggle={toggle}
              >
                <ItemList filters={filters} series={group.key} kind={kind} download={download} />
              </SubHeading>
            ))}
          </ul>
        )
        : <ItemList filters={filters} series={group.key} download={download} />)}
    </li>
  )
}

/**
 * Which Comic Vine volumes this series could be, for reading up on a run before
 * downloading it.
 *
 * Candidates, not an answer. A scraped heading and a Comic Vine volume cannot be matched
 * reliably — "The Mighty Thor" is six volumes, the right one ranks third, and a volume's
 * start year is routinely a year off the first cover date in its run. So the list arrives
 * in Comic Vine's own relevance order and the reader picks the one they meant.
 *
 * Fetched on click rather than on expand: opening a series to reach its download buttons
 * is the common case, and it should not spend one of Comic Vine's 200 requests an hour.
 */
function ComicVineLookup({ series }: { series: string }) {
  const [asked, setAsked] = useState(false)
  const { data, isPending, isError } = useQuery({
    queryKey: ['comicvine-volumes', series],
    queryFn: () => api.getComicVineVolumes(series),
    enabled: asked,
  })

  if (!asked) {
    return (
      <button
        type="button"
        className="btn btn-ghost search-comics__cv-lookup"
        onClick={() => setAsked(true)}
      >
        Look up on Comic Vine
      </button>
    )
  }

  if (isPending) return <p className="search-comics__loading">Looking up Comic Vine…</p>
  if (isError) {
    return <p className="search-comics__error search-comics__cv-error">Could not reach Comic Vine.</p>
  }

  const volumes = data?.volumes ?? []
  if (!volumes.length) {
    return <p className="search-comics__cv-empty">Nothing on Comic Vine for this series.</p>
  }

  return (
    <div className="search-comics__cv">
      {data?.stale && (
        <p className="search-comics__cv-stale">Comic Vine is not answering — showing what we last read.</p>
      )}
      <ul className="search-comics__cv-list">
        {volumes.map((v) => <VolumeCandidate key={v.id} volume={v} />)}
      </ul>
    </div>
  )
}

/** One volume on offer. The whole row is the link out; nothing here needs a second click. */
function VolumeCandidate({ volume }: { volume: CvVolumeMatch }) {
  const name = volume.name ?? 'Untitled volume'
  const title = volume.startYear ? `${name} (${volume.startYear})` : name
  // Publisher and issue count identify a volume between two same-named ones; either may
  // be missing, so the separator is joined rather than written into the markup.
  const facts = [
    volume.publisher,
    volume.issueCount == null
      ? undefined
      : `${volume.issueCount.toLocaleString()} ${volume.issueCount === 1 ? 'issue' : 'issues'}`,
  ].filter(Boolean).join(' · ')

  return (
    <li className="search-comics__cv-row">
      {volume.thumbnail && (
        <img className="search-comics__cv-thumb" src={volume.thumbnail} alt="" loading="lazy" />
      )}
      <div className="search-comics__cv-text">
        <a
          className="search-comics__cv-link"
          href={volume.siteUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          {title}
        </a>
        {facts && <span className="search-comics__cv-facts">{facts}</span>}
        {volume.deck && <span className="search-comics__cv-deck">{volume.deck}</span>}
      </div>
    </li>
  )
}

/** One collapsed line under a series: a run of issues, or a kind of release. */
function SubHeading({ id, label, count, open, toggle, children }: {
  id: string
  label: string
  count: number
  open: Set<string>
  toggle: (key: string) => void
  children: ReactNode
}) {
  const isOpen = open.has(id)
  return (
    <li className="search-comics__kind">
      <button
        type="button"
        className="search-comics__kind-header"
        aria-expanded={isOpen}
        onClick={() => toggle(id)}
      >
        <span className="search-comics__caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
        <span>{label}</span>
        <span className="search-comics__group-count">{count.toLocaleString()}</span>
      </button>
      {isOpen && children}
    </li>
  )
}

/** The rows of one series, or of one run or kind within it. Fetched only once opened. */
function ItemList({ filters, series, kind, run, download }: {
  filters: ComicIndexQuery
  series: string
  kind?: ReleaseKind
  run?: string
  download: DownloadControl
}) {
  const { data, isPending } = useQuery({
    queryKey: ['comic-index-rows', filters.q, filters.category, filters.yearFrom, filters.yearTo, series, kind, run],
    queryFn: () => api.searchComicIndex({ ...filters, series, kind, run, limit: 200 }),
  })

  if (isPending) return <p className="search-comics__loading">Loading…</p>

  const results = data?.results ?? []
  return (
    <ul className="search-comics__results">
      {results.map((r) => (
        <li key={r.id} className="search-comics__row">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="search-comics__link">
            {r.title}
          </a>
          <span className="search-comics__meta">
            {r.number && <span className="search-comics__number">#{r.number}</span>}
            {r.year && <span className="search-comics__year">{r.year}</span>}
            <span className="chip search-comics__category">{r.category}</span>
          </span>
          <button
            type="button"
            className="btn btn-ghost search-comics__download"
            disabled={download.pendingId !== null}
            onClick={() => download.start(r.id)}
          >
            {download.pendingId === r.id ? 'Reading…' : 'Download'}
          </button>
          {download.error?.id === r.id && (
            <span className="search-comics__error search-comics__link-error">
              {download.error.message}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}
