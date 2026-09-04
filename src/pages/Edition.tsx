import { useState } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, STATUS_LABELS } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import EditionEditDialog from '../components/EditionEditDialog'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'

export default function Edition() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const status = statusFrom(searchParams)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['edition', id, status],
    queryFn: () => api.getEditionDetail(id!, status ?? undefined),
  })

  // Removing takes the whole edition, so the confirm must count every issue - the list
  // above it may be showing only the ?status= slice. Fetched only when the dialog opens.
  const { data: unfiltered } = useQuery({
    queryKey: ['edition', id, null],
    queryFn: () => api.getEditionDetail(id!),
    enabled: confirmRemove && status !== null,
  })

  const remove = useMutation({
    mutationFn: () => api.deleteEdition(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      setConfirmRemove(false)
      navigate('/', { replace: true })
    },
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

  // Every other edition, so a Comic Vine rename that lands on a name already in use
  // can be worded as a merge instead. Same list EditionCombobox draws its options from.
  const { data: editionsData } = useQuery({
    queryKey: ['editions', null],
    queryFn: () => api.getEditions(),
  })
  // Pending, errored, or any future paused state all share the same property: we
  // cannot yet tell a rename from a merge. Gate on whether the answer is known at
  // all, not on whether a fetch happens to be in flight right now.
  const editionsKnown = editionsData !== undefined

  // Comic Vine's name for the volume, plus the year its run started, is what this
  // edition should be called. Offered, never applied on its own.
  const suggested = data?.edition.cvName && data.edition.cvStartYear
    ? `${data.edition.cvName} (${data.edition.cvStartYear})`
    : null
  const needsRename = suggested !== null && suggested !== data?.edition.name
  // Renaming onto an existing name merges into it; the button has to say so.
  const collides = needsRename
    && (editionsData?.editions ?? []).some((e) => e.name === suggested && e.id !== data?.edition.id)

  const applyName = useMutation({
    mutationFn: () => api.renameEdition(id!, suggested!, data!.edition.cvName!),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['edition'] })
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      navigate(`/edition/${result.edition.id}`, { replace: true })
    },
  })

  const lookup = useMutation({
    mutationFn: () => api.checkComicVineVolume(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['edition'] }),
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

  // Search the index for the series this edition belongs to, from its first issue
  // onwards. An edition whose series was cleared by hand searches for its own name.
  const findParams = new URLSearchParams({
    q: data.edition.seriesName?.trim() || data.edition.name,
  })
  const years = data.books.map((b) => b.year).filter((y): y is number => typeof y === 'number')
  if (years.length) findParams.set('yearFrom', String(Math.min(...years)))
  const searchHref = `/search?${findParams}`

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
          <Link to={searchHref} className="edition-header__find">Find more</Link>
          <button className="btn-danger" onClick={() => setConfirmRemove(true)}>Remove edition</button>
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
      {confirmRemove && (
        <ConfirmDeleteDialog
          what={`edition "${data.edition.name}"`}
          fileCount={status ? (unfiltered?.books.length ?? null) : bookCount}
          deleting={remove.isPending}
          error={remove.isError ? `Remove failed: ${remove.error?.message}` : null}
          onConfirm={() => remove.mutate()}
          onClose={() => setConfirmRemove(false)}
        />
      )}

      {needsRename && (
        <div className="edition__cv-suggestion">
          <span>Comic Vine calls this <strong>{suggested}</strong></span>
          <button
            type="button"
            className="btn"
            // Withhold the click until we actually know whether this is a rename or a
            // merge - a stale "Rename to ..." label must never be clickable while that
            // answer is unknown, whether because the editions list is still loading or
            // because fetching it failed, since a merge moves files on disk.
            disabled={applyName.isPending || !editionsKnown}
            onClick={() => applyName.mutate()}
          >
            {collides ? `Merge into ${suggested}` : `Rename to ${suggested}`}
          </button>
        </div>
      )}
      {!suggested && (
        <button type="button" className="btn btn-ghost" disabled={lookup.isPending} onClick={() => lookup.mutate()}>
          {lookup.isPending ? 'Checking…' : 'Check Comic Vine'}
        </button>
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
