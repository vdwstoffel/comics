import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'
import FilterSidebar from '../components/FilterSidebar'

export default function Library() {
  const [selectedPublisher, setSelectedPublisher] = useState<string | null>(null)

  const { data: publishersData } = useQuery({
    queryKey: ['publishers'],
    queryFn: api.getPublishers,
  })

  // Always fetch the unfiltered count so we can detect "unknown" series
  const { data: allSeriesData } = useQuery({
    queryKey: ['series', null],
    queryFn: () => api.getSeries(),
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['series-groups', selectedPublisher],
    queryFn: () => api.getSeriesGroups(selectedPublisher ?? undefined),
  })

  const { data: continueData } = useQuery({
    queryKey: ['continue-reading', selectedPublisher],
    queryFn: () => api.getContinueReading(selectedPublisher ?? undefined),
  })

  const continueReading = continueData?.books ?? []
  const publishers = publishersData?.publishers ?? []

  // Build sidebar items: named publishers (label = name, count shown as a separate badge)
  const sidebarItems: { key: string; label: string; count?: number }[] = publishers.map((p) => ({
    key: p.name,
    label: p.name,
    count: p.count,
  }))

  // Show "Unknown" item if any series lack a publisher
  const totalWithPublisher = publishers.reduce((sum, p) => sum + p.count, 0)
  const totalSeries = allSeriesData?.series.length ?? 0
  const unknownCount = totalSeries - totalWithPublisher

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
          onSelect={setSelectedPublisher}
        />
      </nav>
      <div className="library-content">
        {continueReading.length > 0 && (
          <section className="continue-reading">
            <h2 className="section-title">Continue reading</h2>
            <div className="tile-grid">
              {continueReading.map((b) => (
                <CoverTile key={b.id} to={`/read/${b.id}`}
                  img={`/api/books/${b.id}/thumbnail`}
                  title={b.title || `#${b.number ?? '?'}`}
                  subtitle={b.seriesName}
                  readState={b.readState} percent={b.percent} />
              ))}
            </div>
          </section>
        )}

        <h1 className="page-title">Library</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load library.</p>}
        {data && (
          <div className="tile-grid">
            {(data.groups ?? []).map((group) => {
              // A franchise with a single edition would open onto a list of one, so it
              // links straight through to that series instead.
              const only = group.series.length === 1 ? group.series[0] : undefined
              const cover = group.series[0]
              const issues = `${group.bookCount} issue${group.bookCount === 1 ? '' : 's'}`
              return (
                <CoverTile
                  key={group.name}
                  to={only ? `/series/${only.id}` : `/group/${encodeURIComponent(group.name)}`}
                  img={`/api/series/${cover.id}/thumbnail`}
                  title={only ? only.name : group.name}
                  subtitle={only ? issues : `${group.series.length} editions · ${issues}`}
                />
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
