import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'
import CoverTile from '../components/CoverTile.jsx'

export default function Series() {
  const { id } = useParams()
  const { data, isLoading } = useQuery({ queryKey: ['series', id], queryFn: () => api.getSeriesDetail(id) })
  if (isLoading) return <p>Loading…</p>
  return (
    <div style={{ padding: 16 }}>
      <h1>{data.series.name}</h1>
      {data.series.summary && <p style={{ maxWidth: 640 }}>{data.series.summary}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
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
