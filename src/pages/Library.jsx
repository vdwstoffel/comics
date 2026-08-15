import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api.js'
import CoverTile from '../components/CoverTile.jsx'

export default function Library() {
  const { data, isLoading, error } = useQuery({ queryKey: ['series'], queryFn: api.getSeries })
  if (isLoading) return <p>Loading…</p>
  if (error) return <p>Failed to load library.</p>
  return (
    <div style={{ padding: 16 }}>
      <h1>Library</h1>
      <Link to="/upload">+ Upload</Link>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {data.series.map((s) => (
          <CoverTile key={s.id} to={`/series/${s.id}`}
            img={`/api/series/${s.id}/thumbnail`} title={s.name}
            subtitle={`${s.bookCount} issue${s.bookCount === 1 ? '' : 's'}`} />
        ))}
      </div>
    </div>
  )
}
