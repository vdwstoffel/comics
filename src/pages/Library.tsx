import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReadState } from '../api'
import { statusFrom } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'
import { tileLabel } from '../lib/tileLabel'
import { groupBySeries, groupByArc } from '../lib/volumeGroups'
import SeriesGroupTile from '../components/SeriesGroupTile'
import ArcGroupTile from '../components/ArcGroupTile'

/** What an empty result should say, so a blank grid never reads like a failure. */
const NOTHING: Record<ReadState, string> = {
  unread: 'Nothing unread.',
  reading: 'Nothing in progress.',
  read: 'Nothing read yet.',
}

export default function Library() {
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null)
  // Which series has its volumes on screen. One key rather than a flag per tile: the
  // panels float over the shelf, so two of them open at once would overlap into something
  // unreadable, and the shelf has no use for two answers to one question.
  const [openSeries, setOpenSeries] = useState<string | null>(null)
  // The status lives in the url so it survives a refresh and can be carried into
  // every link, which is what keeps the filter applied as you drill down.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedStatus = statusFrom(searchParams)
  // For the same reason: a shelf you gathered into arcs should still be gathered into arcs
  // after a refresh, and should be what a link to it shows.
  const byArc = searchParams.get('group') === 'arcs'

  // A status filter asks a question about comics — "what do I read next" — so it is
  // answered with comics. Without one the shelf is the series level, as it has always
  // been. The two queries are exclusive; only the one being shown runs.
  const showingBooks = selectedStatus !== null

  const series = useQuery({
    queryKey: ['series', selectedPublisher, selectedStatus],
    queryFn: () => api.getSeries({ publisher: selectedPublisher ?? undefined }),
    enabled: !showingBooks,
  })
  const books = useQuery({
    queryKey: ['library-books', selectedPublisher, selectedStatus],
    queryFn: () => api.getLibraryBooks({ readState: selectedStatus!, publisher: selectedPublisher }),
    enabled: showingBooks,
  })

  const { isLoading, error } = showingBooks ? books : series

  const unread = selectedStatus === 'unread' && books.data ? books.data.books : []
  // A shelf with no arcs on it is not offered the toggle: it would be a switch with no
  // effect on anything in front of you.
  const hasArcs = unread.some((b) => b.arcs.length > 0)
  const { arcs, rest } = byArc ? groupByArc(unread) : { arcs: [], rest: unread }
  const seriesGroups = groupBySeries(rest)

  // The two rails are alternatives, not layers: choosing one clears the other.
  const choosePublisher = (key: string | null) => {
    setSelectedPublisher(key)
    setSearchParams({})
  }
  const chooseStatus = (key: string | null) => {
    setSearchParams(key ? { status: key } : {})
    setSelectedPublisher(null)
  }
  const chooseGrouping = (grouped: boolean) => {
    setSearchParams(grouped ? { status: 'unread', group: 'arcs' } : { status: 'unread' })
  }

  return (
    <>
      <LibraryRail
        activePublisher={selectedPublisher}
        activeStatus={selectedStatus}
        onPublisher={choosePublisher}
        onStatus={chooseStatus}
      />
      <main className="library-content">

        <h1 className="page-title">Library</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load library.</p>}
        {showingBooks && books.data && (
          books.data.books.length === 0
            ? <p>{NOTHING[selectedStatus]}</p>
            : selectedStatus === 'unread'
              ? (
                <>
                  {/* Unread is the shelf that accumulates - a run you are behind on puts
                      every one of its issues here at once - so it collapses, to a tile per
                      series and, inside that, a tile per volume. Reading holds the one or
                      two comics you are partway through, where a group would only add a
                      click to reach a comic you are already in the middle of. */}
                  {hasArcs && (
                    <label className="shelf-toggle">
                      <input
                        type="checkbox"
                        checked={byArc}
                        onChange={(e) => chooseGrouping(e.target.checked)}
                      />
                      Group story arcs
                    </label>
                  )}
                  {arcs.length > 0 && (
                    <>
                      {/* Named only when both halves are on the shelf: a single unlabelled
                          grid is what every other view here is. */}
                      {seriesGroups.length > 0 && <h2 className="shelf-heading">Story Arcs</h2>}
                      <div className="tile-grid">
                        {arcs.map((arc) => <ArcGroupTile key={arc.name} group={arc} />)}
                      </div>
                      {seriesGroups.length > 0 && <h2 className="shelf-heading">Series</h2>}
                    </>
                  )}
                  {seriesGroups.length > 0 && (
                    <div className="tile-grid">
                      {seriesGroups.map((group) => (
                        <SeriesGroupTile
                          key={group.key}
                          group={group}
                          open={openSeries === group.key}
                          onToggle={() => setOpenSeries(openSeries === group.key ? null : group.key)}
                          onClose={() => setOpenSeries(null)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )
              : (
                <div className="tile-grid">
                  {books.data.books.map((b) => (
                    <CoverTile
                      key={b.id}
                      to={`/book/${b.id}`}
                      img={`/api/books/${b.id}/thumbnail`}
                      title={tileLabel(b)}
                      subtitle={b.number ? `#${b.number}` : ''}
                      readState={b.readState}
                      percent={b.percent}
                    />
                  ))}
                </div>
              )
        )}
        {!showingBooks && series.data && (
          <div className="tile-grid">
            {(series.data.series ?? []).map((series) => {
              // The home screen is the series level throughout - even a series holding a
              // single edition is opened through its own page, so the hierarchy reads the
              // same way everywhere. The cover still comes from the first edition.
              const cover = series.editions[0]
              const editions = series.editions.length
              return (
                <CoverTile
                  key={series.name}
                  to={`/series/${encodeURIComponent(series.name)}`}
                  img={`/api/editions/${cover.id}/thumbnail`}
                  title={series.name}
                  subtitle={`${editions} edition${editions === 1 ? '' : 's'} · ${series.bookCount} issue${series.bookCount === 1 ? '' : 's'}`}
                />
              )
            })}
          </div>
        )}
      </main>

    </>
  )
}
