import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'

export default function Library() {
  const { data, isLoading, error } = useQuery({ queryKey: ['series'], queryFn: api.getSeries })
  if (isLoading) return <p>Loading…</p>
  if (error) return <p>Failed to load library.</p>
  if (!data) return null
  return (
    <div>
      <h1 className="page-title">Library</h1>
      <div className="tile-grid">
        {data.series.map((s) => (
          <CoverTile key={s.id} to={`/series/${s.id}`}
            img={`/api/series/${s.id}/thumbnail`} title={s.name}
            subtitle={`${s.bookCount} issue${s.bookCount === 1 ? '' : 's'}`} />
        ))}
      </div>
    </div>
  )
}
