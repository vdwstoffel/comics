import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'

export default function Series() {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const seriesName = decodeURIComponent(name ?? '')
  const status = statusFrom(searchParams)

  const { data, isLoading, error } = useQuery({
    queryKey: ['series', seriesName, status],
    queryFn: () => api.getSeriesByName(seriesName, status ?? undefined),
  })

  if (isLoading) return <p>Loading…</p>
  if (error || !data) return <p>That series was not found.</p>

  const { series } = data
  const editions = series.editions.length

  return (
    <div>
      <h1 className="page-title">{series.name}</h1>
      <p className="page-subtitle">
        {editions} edition{editions === 1 ? '' : 's'} · {series.bookCount} issue
        {series.bookCount === 1 ? '' : 's'}
      </p>
      <div className="tile-grid">
        {series.editions.map((edition) => (
          <CoverTile
            key={edition.id}
            to={withStatus(`/edition/${edition.id}`, status)}
            img={`/api/editions/${edition.id}/thumbnail`}
            title={edition.name}
            subtitle={`${edition.bookCount} issue${edition.bookCount === 1 ? '' : 's'}`}
          />
        ))}
      </div>
    </div>
  )
}
