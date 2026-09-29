import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueries } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import { splitAnnuals, annualYear } from '../lib/annuals'

/**
 * Every annual of one series, as the comics themselves.
 *
 * Comic Vine opens a new volume for each year's annual, so the library holds one
 * single-issue edition per year. Listing those editions would put a volume between you
 * and a comic that is the only thing in it, so this page skips that level and shows the
 * comics - which is what the run's own page does, and the reason this is a page at all
 * rather than the panel it started as.
 *
 * Named by year throughout: an annual is issue #1 of its own volume nearly every time, so
 * the number tells one from another exactly never.
 */
export default function SeriesAnnuals() {
  const { name } = useParams()
  const seriesName = decodeURIComponent(name ?? '')
  const [searchParams] = useSearchParams()
  const status = statusFrom(searchParams)

  // The same key the series page uses, so arriving here from it costs no second request.
  const { data, isLoading, error } = useQuery({
    queryKey: ['series', seriesName, status],
    queryFn: () => api.getSeriesByName(seriesName, status ?? undefined),
  })

  // By year, because the server sorts editions by name - which files "Amazing Spider-Man
  // Annual (2026)" before "The Amazing Spider-Man Annual (2024)" on the strength of an
  // article. An annual whose name carries no year at all sorts last, where a reader
  // looking for a year will not be searching for it.
  const annuals = [...splitAnnuals(data?.series.editions ?? []).annuals].sort((a, b) => (
    (annualYear(a.name) ?? '9999').localeCompare(annualYear(b.name) ?? '9999')
  ))

  // One request per annual, which is a handful: the series answer carries how many issues
  // each edition holds but not which, and a page of comics needs the comics. They are
  // keyed as the edition page keys them, so a comic opened from here is already loaded.
  const details = useQueries({
    queries: annuals.map((edition) => ({
      queryKey: ['edition', String(edition.id), status],
      queryFn: () => api.getEditionDetail(edition.id, status ?? undefined),
    })),
  })

  if (isLoading) return <p>Loading…</p>
  if (error || !data) return <p>That series was not found.</p>

  const comics = annuals.flatMap((edition, i) => (
    (details[i]?.data?.books ?? []).map((book) => ({ book, year: annualYear(edition.name), edition }))
  ))

  return (
    <div>
      <Link to={withStatus(`/series/${encodeURIComponent(seriesName)}`, status)} className="back-link">
        ← {data.series.name}
      </Link>
      <h1 className="page-title">Annuals</h1>
      <p className="page-subtitle">
        {annuals.length} annual{annuals.length === 1 ? '' : 's'}
      </p>

      <div className="tile-grid">
        {comics.map(({ book, year, edition }) => (
          <CoverTile
            key={book.id}
            to={`/book/${book.id}`}
            img={`/api/books/${book.id}/thumbnail`}
            // The year names the comic here. Its own name is the fallback for an annual
            // whose volume was given no year to read.
            title={year ?? edition.name}
            // Only when the comic has a name of its own - "#1" beneath "2026" would be
            // the very thing this page exists to stop saying.
            subtitle={book.title ?? undefined}
            readState={book.readState}
            percent={book.percent}
          />
        ))}
      </div>
    </div>
  )
}
