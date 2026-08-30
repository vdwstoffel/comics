import { useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, STATUS_LABELS } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import SeriesEditDialog from '../components/SeriesEditDialog'

export default function Series() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const status = statusFrom(searchParams)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['series', id, status],
    queryFn: () => api.getSeriesDetail(id!, status ?? undefined),
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
        {status && (
          <p className="series-header__filter">
            Showing {STATUS_LABELS[status].toLowerCase()} issues
            {' · '}
            <Link to={`/series/${id}`}>Show all</Link>
          </p>
        )}
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
