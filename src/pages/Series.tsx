import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'

export default function Series() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['series', id],
    queryFn: () => api.getSeriesDetail(id!),
  })

  const rename = useMutation({
    mutationFn: (name: string) => api.renameSeries(id!, name),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['series'] })
      setEditing(false)
      navigate(`/series/${result.series.id}`)
    },
  })

  const handleEditClick = () => {
    setNameInput(data?.series.name ?? '')
    setEditing(true)
  }

  const handleSave = () => {
    const trimmed = nameInput.trim()
    if (trimmed) rename.mutate(trimmed)
  }

  if (isLoading) return <p>Loading…</p>
  if (!data) return null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        {editing ? (
          <>
            <input
              className="field-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
              autoFocus
            />
            <button className="btn" onClick={handleSave} disabled={rename.isPending}>Save</button>
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
          </>
        ) : (
          <>
            <h1 className="page-title">{data.series.name}</h1>
            <button className="btn-ghost" onClick={handleEditClick} title="Edit series name">✏️</button>
          </>
        )}
      </div>
      {rename.isError && <p style={{ color: 'red' }}>Rename failed: {rename.error?.message}</p>}
      {data.series.summary && <p className="page-subtitle">{data.series.summary}</p>}
      <div className="tile-grid">
        {data.books.map((b) => (
          <CoverTile
            key={b.id}
            to={`/book/${b.id}`}
            img={`/api/books/${b.id}/thumbnail`}
            title={b.title || `#${b.number ?? '?'}`}
            subtitle={b.number ? `#${b.number}` : ''}
          />
        ))}
      </div>
    </div>
  )
}
