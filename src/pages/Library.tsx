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
    queryKey: ['series', selectedPublisher],
    queryFn: () => api.getSeries(selectedPublisher ?? undefined),
  })

  const publishers = publishersData?.publishers ?? []

  // Build sidebar items: named publishers
  const sidebarItems = publishers.map((p) => ({ key: p.name, label: `${p.name} ${p.count}` }))

  // Show "Unknown" item if any series lack a publisher
  const totalWithPublisher = publishers.reduce((sum, p) => sum + p.count, 0)
  const totalSeries = allSeriesData?.series.length ?? 0
  const hasUnknown = totalSeries > totalWithPublisher

  if (hasUnknown) {
    sidebarItems.push({ key: '__unknown__', label: 'Unknown' })
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
        <h1 className="page-title">Library</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load library.</p>}
        {data && (
          <div className="tile-grid">
            {data.series.map((s) => (
              <CoverTile key={s.id} to={`/series/${s.id}`}
                img={`/api/series/${s.id}/thumbnail`} title={s.name}
                subtitle={`${s.bookCount} issue${s.bookCount === 1 ? '' : 's'}`} />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
