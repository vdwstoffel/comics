import { useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { splitAnnuals } from '../lib/annuals'
import { useBackOrigin } from '../lib/backOrigin'

export default function Series() {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const seriesName = decodeURIComponent(name ?? '')
  const status = statusFrom(searchParams)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const back = useBackOrigin()

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

  // Comic Vine gives each year's annual its own volume, so a run followed for a while
  // brings one single-issue edition per year. Collapsed, they are one tile.
  //
  // Only from two upwards: a tile that opens onto a single tile is a click that buys
  // nothing, which is the rule the shelf already applies to a series holding one volume.
  const { runs, annuals } = splitAnnuals(series.editions)
  const grouped = annuals.length > 1
  const shown = grouped ? runs : series.editions
  // An edition the server did not count contributes nothing rather than an NaN subtitle.
  const annualIssues = annuals.reduce((n, e) => n + (e.bookCount ?? 0), 0)

  // Under a ?status= filter the listed editions are only a slice, so the confirm waits
  // for the unfiltered series rather than understating what it is about to delete.
  const scope = status ? unfiltered?.series : series
  const editionCount = scope?.editions.length ?? null
  const issueCount = scope?.bookCount ?? null

  return (
    <div>
      <Link to="/" className="back-link">← Library</Link>
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
        {shown.map((edition) => (
          <CoverTile
            key={edition.id}
            to={withStatus(`/edition/${edition.id}`, status)}
            state={back}
            img={`/api/editions/${edition.id}/thumbnail`}
            title={edition.name}
            subtitle={`${edition.bookCount} issue${edition.bookCount === 1 ? '' : 's'}`}
          />
        ))}
        {grouped && (
          <CoverTile
            to={withStatus(`/series/${encodeURIComponent(seriesName)}/annuals`, status)}
            /* The first annual's cover, because the group has no art of its own and a
               blank box beside the run would read as a thumbnail that failed to load. */
            img={`/api/editions/${annuals[0].id}/thumbnail`}
            title="Annuals"
            subtitle={`${annualIssues} issue${annualIssues === 1 ? '' : 's'}`}
          />
        )}
      </div>
    </div>
  )
}
