import { useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, STATUS_LABELS } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import EditionEditDialog from '../components/EditionEditDialog'

export default function Edition() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const status = statusFrom(searchParams)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['edition', id, status],
    queryFn: () => api.getEditionDetail(id!, status ?? undefined),
  })

  const rename = useMutation({
    mutationFn: (name: string) => api.renameEdition(id!, name),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['edition'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      setEditing(false)
      navigate(`/edition/${result.edition.id}`)
    },
  })

  const setSeries = useMutation({
    mutationFn: (seriesName: string) => api.setEditionSeries(id!, seriesName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['edition', id] })
      qc.invalidateQueries({ queryKey: ['series'] })
    },
  })

  const handleSave = async ({ name, seriesName }: { name: string; seriesName: string }) => {
    // Only send what actually changed: a rename also moves files on disk.
    if (seriesName !== (data?.edition.seriesName ?? '')) await setSeries.mutateAsync(seriesName)
    if (name !== data?.edition.name) {
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
      <div className="edition-header">
        <div className="edition-header__title-row">
          <h1 className="page-title">{data.edition.name}</h1>
          <button className="btn-icon" onClick={() => setEditing(true)}
            title="Edit edition" aria-label="Edit edition">
            ✏
          </button>
        </div>
        <p className="edition-header__count">{bookLabel}</p>
        {status && (
          <p className="edition-header__filter">
            Showing {STATUS_LABELS[status].toLowerCase()} issues
            {' · '}
            <Link to={`/edition/${id}`}>Show all</Link>
          </p>
        )}
        {data.edition.summary && <p className="edition-header__summary">{data.edition.summary}</p>}
      </div>

      {editing && (
        <EditionEditDialog
          name={data.edition.name}
          seriesName={data.edition.seriesName ?? null}
          saving={rename.isPending || setSeries.isPending}
          error={
            rename.isError ? `Rename failed: ${rename.error?.message}`
              : setSeries.isError ? `Could not change series: ${setSeries.error?.message}`
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
