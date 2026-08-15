import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'

export default function Series() {
  const { id } = useParams()
  const { data, isLoading } = useQuery({ queryKey: ['series', id], queryFn: () => api.getSeriesDetail(id!) })
  if (isLoading) return <p>Loading…</p>
  if (!data) return null
  return (
    <div>
      <h1 className="page-title">{data.series.name}</h1>
      {data.series.summary && <p className="page-subtitle">{data.series.summary}</p>}
      <div className="tile-grid">
        {data.books.map((b) => (
          <CoverTile key={b.id} to={`/book/${b.id}`}
            img={`/api/books/${b.id}/thumbnail`}
            title={b.title || `#${b.number ?? '?'}`}
            subtitle={b.number ? `#${b.number}` : ''} />
        ))}
      </div>
    </div>
  )
}
