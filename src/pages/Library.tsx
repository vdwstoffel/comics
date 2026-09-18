import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReadState } from '../api'
import { statusFrom } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'
import { tileLabel } from '../lib/tileLabel'
import { groupByVolume } from '../lib/volumeGroups'
import VolumeGroupTile from '../components/VolumeGroupTile'

/** What an empty result should say, so a blank grid never reads like a failure. */
const NOTHING: Record<ReadState, string> = {
  unread: 'Nothing unread.',
  reading: 'Nothing in progress.',
  read: 'Nothing read yet.',
}

export default function Library() {
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null)
  // The status lives in the url so it survives a refresh and can be carried into
  // every link, which is what keeps the filter applied as you drill down.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedStatus = statusFrom(searchParams)

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

  const volumes = showingBooks && selectedStatus === 'unread' && books.data
    ? groupByVolume(books.data.books)
    : []

  // The two rails are alternatives, not layers: choosing one clears the other.
  const choosePublisher = (key: string | null) => {
    setSelectedPublisher(key)
    setSearchParams({})
  }
  const chooseStatus = (key: string | null) => {
    setSearchParams(key ? { status: key } : {})
    setSelectedPublisher(null)
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
            : (
              <div className="tile-grid">
                {/* Unread is the shelf that accumulates - a run you are behind on puts
                    every one of its issues here at once - so it collapses to a tile per
                    volume, opening on the comic at the front of that run. Reading holds
                    the one or two comics you are partway through, where a group would only
                    add a click to reach a comic you are already in the middle of. */}
                {selectedStatus === 'unread'
                  ? volumes.map((group) => (
                    <VolumeGroupTile key={group.editionId} group={group} />
                  ))
                  : books.data.books.map((b) => (
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
