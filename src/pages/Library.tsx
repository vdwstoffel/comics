import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReadState } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'

export default function Library() {
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null)
  // The status lives in the url so it survives a refresh and can be carried into
  // every link, which is what keeps the filter applied as you drill down.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedStatus = statusFrom(searchParams)

  const { data, isLoading, error } = useQuery({
    queryKey: ['series', selectedPublisher, selectedStatus],
    queryFn: () => api.getSeries({
      publisher: selectedPublisher ?? undefined,
      readState: selectedStatus ?? undefined,
    }),
  })

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
        {data && (
          <div className="tile-grid">
            {(data.series ?? []).map((series) => {
              // The home screen is the series level throughout - even a series holding a
              // single edition is opened through its own page, so the hierarchy reads the
              // same way everywhere. The cover still comes from the first edition.
              const cover = series.editions[0]
              const editions = series.editions.length
              return (
                <CoverTile
                  key={series.name}
                  to={withStatus(`/series/${encodeURIComponent(series.name)}`, selectedStatus)}
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
