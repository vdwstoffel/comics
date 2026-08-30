import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ScrapeStatus } from '../api'

const PAGE_SIZE = 50
const DEBOUNCE_MS = 250
const POLL_MS = 1000

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

  const { data, isFetching, isFetchingNextPage, hasNextPage, fetchNextPage, error } =
    useInfiniteQuery({
      queryKey: ['comic-index', query, category, years.from, years.to],
      queryFn: ({ pageParam }) =>
        api.searchComicIndex({
          q: query,
          category: category ?? undefined,
          yearFrom: years.from,
          yearTo: years.to,
          limit: PAGE_SIZE,
          offset: pageParam,
        }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, allPages) => {
        const loaded = allPages.reduce((n, page) => n + page.results.length, 0)
        return loaded < lastPage.total ? loaded : undefined
      },
      enabled: query.length > 0,
    })

  const results = data?.pages.flatMap((page) => page.results) ?? []
  const total = data?.pages[0]?.total ?? 0
  const searching = query.length > 0

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
            {isFetching && !isFetchingNextPage && results.length === 0
              ? 'Searching…'
              : total === 0
                ? 'No matches'
                : `${total.toLocaleString()} matches`}
          </p>

          <ul className="search-comics__results">
            {results.map((r) => (
              <li key={r.id} className="search-comics__row">
                <a
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="search-comics__link"
                >
                  {r.title}
                </a>
                <span className="search-comics__meta">
                  {r.number && <span className="search-comics__number">#{r.number}</span>}
                  {r.year && <span className="search-comics__year">{r.year}</span>}
                  <span className="chip search-comics__category">{r.category}</span>
                </span>
              </li>
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
