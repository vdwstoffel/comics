import { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

export default function Series() {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const seriesName = decodeURIComponent(name ?? '')
  const status = statusFrom(searchParams)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirmRemove, setConfirmRemove] = useState(false)

  const { data, isLoading, error } = useQuery({
    queryKey: ['series', seriesName, status],
    queryFn: () => api.getSeriesByName(seriesName, status ?? undefined),
  })

  // Same reason as the edition page: a ?status= filter narrows the editions listed, so
  // the confirm counts the whole series instead of the visible slice.
  const { data: unfiltered } = useQuery({
    queryKey: ['series', seriesName, null],
    queryFn: () => api.getSeriesByName(seriesName),
    enabled: confirmRemove && status !== null,
  })

  const remove = useMutation({
    mutationFn: () => api.deleteSeries(seriesName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['series'] })
      qc.invalidateQueries({ queryKey: ['editions'] })
      setConfirmRemove(false)
      navigate('/', { replace: true })
    },
  })

  if (isLoading) return <p>Loading…</p>
  if (error || !data) return <p>That series was not found.</p>

  const { series } = data
  const editions = series.editions.length

  // Under a ?status= filter the listed editions are only a slice, so the confirm waits
  // for the unfiltered series rather than understating what it is about to delete.
  const scope = status ? unfiltered?.series : series
  const editionCount = scope?.editions.length ?? null
  const issueCount = scope?.bookCount ?? null

  return (
    <div>
      <div className="series-header__title-row">
        <h1 className="page-title">{series.name}</h1>
        <button className="btn-danger" onClick={() => setConfirmRemove(true)}>Remove series</button>
      </div>
      <p className="page-subtitle">
        {editions} edition{editions === 1 ? '' : 's'} · {series.bookCount} issue
        {series.bookCount === 1 ? '' : 's'}
      </p>
      {confirmRemove && (
        <ConfirmDeleteDialog
          what={`series "${series.name}"`}
          detail={
            scope
              ? `${editionCount} edition${editionCount === 1 ? '' : 's'} · ${issueCount} issue${issueCount === 1 ? '' : 's'}`
              : undefined
          }
          fileCount={issueCount}
          deleting={remove.isPending}
          error={remove.isError ? `Remove failed: ${remove.error?.message}` : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirmRemove(false)}
        />
      )}

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
