import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReadState } from '../api'
import { statusFrom, withStatus, STATUS_LABELS } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import FilterSidebar from '../components/FilterSidebar'

export default function Library() {
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null)
  // The status lives in the url so it survives a refresh and can be carried into
  // every link, which is what keeps the filter applied as you drill down.
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedStatus = statusFrom(searchParams)

  const { data: publishersData } = useQuery({
    queryKey: ['publishers'],
    queryFn: api.getPublishers,
  })

  // Always fetch the unfiltered count so we can detect "unknown" editions
  const { data: allEditionsData } = useQuery({
    queryKey: ['editions', null],
    queryFn: () => api.getEditions(),
  })

  const { data: readStateData } = useQuery({
    queryKey: ['read-states'],
    queryFn: api.getReadStates,
  })

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

  const publishers = publishersData?.publishers ?? []

  // Build sidebar items: named publishers (label = name, count shown as a separate badge)
  const sidebarItems: { key: string; label: string; count?: number }[] = publishers.map((p) => ({
    key: p.name,
    label: p.name,
    count: p.count,
  }))

  // Show "Unknown" item if any editions lack a publisher
  const totalWithPublisher = publishers.reduce((sum, p) => sum + p.count, 0)
  const totalEditions = allEditionsData?.editions.length ?? 0
  const unknownCount = totalEditions - totalWithPublisher

  if (unknownCount > 0) {
    sidebarItems.push({ key: '__unknown__', label: 'Unknown', count: unknownCount })
  }

  return (
    <>
      <nav className="library-rail">
        <FilterSidebar
          title="Publishers"
          items={sidebarItems}
          active={selectedPublisher}
          onSelect={choosePublisher}
        />
        <FilterSidebar
          title="Status"
          items={(readStateData?.readStates ?? []).map((s) => ({
            key: s.name,
            label: STATUS_LABELS[s.name],
            count: s.count,
          }))}
          active={selectedStatus}
          onSelect={chooseStatus}
        />
      </nav>
      <div className="library-content">

        <h1 className="page-title">Library</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load library.</p>}
        {data && (
          <div className="tile-grid">
            {(data.series ?? []).map((series) => {
              // A series with a single edition would open onto a list of one, so it
              // links straight through to that edition instead.
              const only = series.editions.length === 1 ? series.editions[0] : undefined
              const cover = series.editions[0]
              const issues = `${series.bookCount} issue${series.bookCount === 1 ? '' : 's'}`
              return (
                <CoverTile
                  key={series.name}
                  to={withStatus(
                    only ? `/edition/${only.id}` : `/series/${encodeURIComponent(series.name)}`,
                    selectedStatus,
                  )}
                  img={`/api/editions/${cover.id}/thumbnail`}
                  title={only ? only.name : series.name}
                  subtitle={only ? issues : `${series.editions.length} editions · ${issues}`}
                />
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
