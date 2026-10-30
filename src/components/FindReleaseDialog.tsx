import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ComicIndexResult } from '../api'
import { searchHref } from '../lib/findIssueSeed'
import type { IssueSeed } from '../lib/findIssueSeed'

interface FindReleaseDialogProps {
  /**
   * The gap in full - "Thor (2025) #2". Composed by the call site, because only the page
   * knows what context its reader is missing: the tile beside the control already says
   * "#2", and a dialog floating over the page does not.
   */
  gapLabel: string
  /** Where the search starts: the series and a year floor. See findIssueSeed. */
  seed: IssueSeed
  /**
   * Start the download of the chosen row. The dialog never knows which of the three
   * routes it is talking to - an arc and This week resolve the destination edition
   * server-side, and an edition page names its own.
   */
  onDownload: (indexId: number) => Promise<unknown>
  onClose: () => void
}

/** The rows of one opened heading. Fetched only when you open it. */
function GroupRows({ q, yearFrom, series, selected, onSelect }: {
  q: string
  yearFrom?: number
  series: string
  selected: number | null
  onSelect: (row: ComicIndexResult) => void
}) {
  // 200 is the server's cap, and the same window the search page opens a heading with.
  const { data, isPending } = useQuery({
    queryKey: ['find-release-rows', q, yearFrom, series],
    queryFn: () => api.searchComicIndex({ q, yearFrom, series, limit: 200 }),
  })

  if (isPending) return <p className="find-release__loading">Loading…</p>

  const rows = data?.results ?? []
  const total = data?.total ?? rows.length
  return (
    <ul className="find-release__rows">
      {rows.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            className="find-release__row"
            aria-pressed={selected === r.id}
            onClick={() => onSelect(r)}
          >
            <span className="find-release__row-title">{r.title}</span>
            {r.year && <span className="find-release__row-year">{r.year}</span>}
            <span className="chip find-release__row-category">{r.category}</span>
          </button>
        </li>
      ))}
      {/* The cap is 200 and a heading can hold more. Saying so beats a list that just
          stops: the whole point of this dialog is that you can trust what it shows. */}
      {total > rows.length && (
        <li className="find-release__more">
          Showing {rows.length} of {total}. Narrow the search to see the rest.
        </li>
      )}
    </ul>
  )
}

/**
 * Fill one gap from the scraped index, without leaving the page.
 *
 * This is what `Find` opens. It exists because the page already knows which Comic Vine
 * issue the gap is - the id that drew the tile - and the old `Find` link threw that away
 * by navigating, leaving the upload page to guess the comic's identity back out of a
 * filename. Here the gap is named in the heading the whole time and the id goes straight
 * into the download, so a release found by hand files exactly as `Get` would.
 *
 * Results are grouped by series rather than listed flat, and that is not cosmetic. The
 * case this dialog exists for is the index calling a volume something other than Comic
 * Vine does - `Thor (2025)` is posted as `The Mortal Thor`. Searching the series name
 * alone returns 64 rows for Thor, with the wanted one at position 36, ordered
 * alphabetically with no relevance ranking; the same 64 collapse to 6 headings, and the
 * renamed series is one of them. The sizes get worse, not better: `batman` is 2,338 rows.
 */
export default function FindReleaseDialog({ gapLabel, seed, onDownload, onClose }: FindReleaseDialogProps) {
  const [input, setInput] = useState(seed.q)
  const [query, setQuery] = useState(seed.q)
  // Cleared, not edited. The floor is a guess about the release year and the one thing a
  // reader may need to undo - 3,101 indexed posts have no parsed year at all, and a
  // bounded query drops every one of them.
  const [yearFrom, setYearFrom] = useState<number | undefined>(seed.yearFrom)
  const [open, setOpen] = useState<string | null>(null)
  const [picked, setPicked] = useState<ComicIndexResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An empty seed is This week's, where an issue may carry no volume name. Searching
  // nothing answers nothing, which would read as "not in the index" rather than
  // "nothing asked".
  const { data, isFetching } = useQuery({
    queryKey: ['find-release-groups', query, yearFrom],
    queryFn: () => api.groupComicIndex({ q: query, yearFrom, limit: 50 }),
    enabled: query.trim().length > 0,
  })

  const box = useRef<HTMLInputElement>(null)
  useEffect(() => { if (!seed.q.trim()) box.current?.focus() }, [seed.q])

  function search(next = input) {
    setQuery(next.trim())
    // A new search invalidates which heading was open and what was picked under it.
    setOpen(null)
    setPicked(null)
    setError(null)
  }

  async function download() {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      await onDownload(picked.id)
      onClose()
    } catch (err) {
      // Already queued is the one refusal that means the download you wanted is happening.
      // Holding the dialog open to report it would invite a second press for the same comic.
      if ((err as { reason?: string }).reason === 'duplicate') { onClose(); return }
      setError((err as Error).message || 'Could not start that download.')
      setBusy(false)
    }
  }

  const groups = data?.groups ?? []
  const searched = query.trim().length > 0
  const nothing = searched && !isFetching && groups.length === 0

  return (
    <div className="modal-backdrop">
      <div className="modal-panel modal-panel--wide">
        <h3>Find a release</h3>
        {/* Named here and again in the footer: the gap is what the whole dialog is about,
            and the footer is the last thing read before the press that commits. */}
        <p className="find-release__gap">Filling <strong>{gapLabel}</strong></p>

        <div className="cv-search-row">
          <input
            ref={box}
            aria-label="Search the index"
            placeholder="Search the index"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') search() }}
          />
          <button type="button" className="btn" onClick={() => search()}>Search</button>
        </div>

        <div className="find-release__filters">
          {yearFrom !== undefined && (
            <button
              type="button"
              className="chip chip--action find-release__year"
              aria-label={`Searching from ${yearFrom} onwards. Clear the year filter.`}
              onClick={() => { setYearFrom(undefined); setOpen(null); setPicked(null) }}
            >
              from {yearFrom} <span aria-hidden="true">×</span>
            </button>
          )}
          {searched && !isFetching && (
            <span className="find-release__count">
              {data?.totalResults ?? 0} in {data?.totalGroups ?? 0} series
            </span>
          )}
        </div>

        {isFetching && <p className="find-release__loading">Searching…</p>}

        {nothing && (
          <p className="find-release__empty">
            Nothing in the index matches that.{' '}
            {/* The dialog has no Check for new and no Full scrape - those live on the
                search page, and an index that does not hold the comic is the one dead
                end worth leaving the page for. */}
            <Link to={searchHref({ q: query, yearFrom })}>Open it in Search comics</Link> to
            scrape for new releases.
          </p>
        )}

        <ul className="find-release__groups">
          {groups.map((g) => (
            <li key={g.key}>
              <button
                type="button"
                className="find-release__group"
                aria-expanded={open === g.key}
                onClick={() => { setOpen(open === g.key ? null : g.key); setError(null) }}
              >
                <span aria-hidden="true">{open === g.key ? '▾' : '▸'}</span>
                <span className="find-release__group-name">{g.name}</span>
                <span className="find-release__group-count">{g.total}</span>
              </button>
              {open === g.key && (
                <GroupRows
                  q={query}
                  yearFrom={yearFrom}
                  series={g.key}
                  selected={picked?.id ?? null}
                  onSelect={(r) => { setPicked(r); setError(null) }}
                />
              )}
            </li>
          ))}
        </ul>

        {error && <p className="cv-error" role="alert">{error}</p>}

        <div className="find-release__foot">
          <span className="find-release__files-as">
            {picked
              // The issue, not the folder: an arc and This week resolve where the file
              // lands inside the route, from data this page never sees.
              ? <>Files as <strong>{gapLabel}</strong></>
              : 'Pick a release'}
          </span>
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={!picked || busy} onClick={() => void download()}>
            {busy ? 'Starting…' : 'Download'}
          </button>
        </div>
      </div>
    </div>
  )
}
