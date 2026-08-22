import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import CoverTile from '../components/CoverTile'
import SeriesEditDialog from '../components/SeriesEditDialog'

export default function Series() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

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

  const setGroup = useMutation({
    mutationFn: (groupName: string) => api.setSeriesGroup(id!, groupName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series', id] })
      qc.invalidateQueries({ queryKey: ['series-groups'] })
    },
  })

  const handleSave = async ({ name, groupName }: { name: string; groupName: string }) => {
    // Only send what actually changed: a rename also moves files on disk.
    if (groupName !== (data?.series.groupName ?? '')) await setGroup.mutateAsync(groupName)
    if (name !== data?.series.name) {
      rename.mutate(name)
      return
    }
    setEditing(false)
  }

  if (isLoading) return <p>Loading…</p>
  if (!data) return null

  const bookCount = data.books.length
  const bookLabel = `${bookCount} book${bookCount === 1 ? '' : 's'}`

  return (
    <div>
      <Link to="/" className="back-link">← Library</Link>
      <div className="series-header">
        <div className="series-header__title-row">
          <h1 className="page-title">{data.series.name}</h1>
          <button className="btn-icon" onClick={() => setEditing(true)}
            title="Edit series" aria-label="Edit series">
            ✏
          </button>
        </div>
        <p className="series-header__count">{bookLabel}</p>
        {data.series.summary && <p className="series-header__summary">{data.series.summary}</p>}
      </div>

      {editing && (
        <SeriesEditDialog
          name={data.series.name}
          groupName={data.series.groupName ?? null}
          saving={rename.isPending || setGroup.isPending}
          error={
            rename.isError ? `Rename failed: ${rename.error?.message}`
              : setGroup.isError ? `Could not change group: ${setGroup.error?.message}`
                : null
          }
          onSave={handleSave}
          onClose={() => setEditing(false)}
        />
      )}
      <div className="tile-grid">
        {data.books.map((b) => (
          <CoverTile
            key={b.id}
            to={`/book/${b.id}`}
            img={`/api/books/${b.id}/thumbnail`}
            title={b.title || `#${b.number ?? '?'}`}
            subtitle={b.number ? `#${b.number}` : ''}
            readState={b.readState}
            percent={b.percent}
          />
        ))}
      </div>
    </div>
  )
}
