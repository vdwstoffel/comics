import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'

export default function SeriesGroup() {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const groupName = decodeURIComponent(name ?? '')
  const status = statusFrom(searchParams)

  const { data, isLoading, error } = useQuery({
    queryKey: ['series-group', groupName, status],
    queryFn: () => api.getSeriesGroup(groupName, status ?? undefined),
  })

  if (isLoading) return <p>Loading…</p>
  if (error || !data) return <p>That group was not found.</p>

  const { group } = data
  const editions = group.series.length

  return (
    <div>
      <h1 className="page-title">{group.name}</h1>
      <p className="page-subtitle">
        {editions} edition{editions === 1 ? '' : 's'} · {group.bookCount} issue
        {group.bookCount === 1 ? '' : 's'}
      </p>
      <div className="tile-grid">
        {group.series.map((series) => (
          <CoverTile
            key={series.id}
            to={withStatus(`/series/${series.id}`, status)}
            img={`/api/series/${series.id}/thumbnail`}
            title={series.name}
            subtitle={`${series.bookCount} issue${series.bookCount === 1 ? '' : 's'}`}
          />
        ))}
      </div>
    </div>
  )
}
