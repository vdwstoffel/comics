import { useState } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { statusFrom, withStatus } from '../lib/readStatus'
import CoverTile from '../components/CoverTile'
import ConfirmDeleteDialog from '../components/ConfirmDeleteDialog'
import { splitAnnuals } from '../lib/annuals'
import { useBackOrigin } from '../lib/backOrigin'
import OtherVolumes from '../components/OtherVolumes'
import { useDocumentTitle } from '../lib/useDocumentTitle'

export default function Series() {
  const { name } = useParams()
  const [searchParams] = useSearchParams()
  const seriesName = decodeURIComponent(name ?? '')
  useDocumentTitle(seriesName)
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
  // the confirm counts the whole series instead of the visible slice. The shelf of other
  // volumes needs it for the same reason - what is hidden by a filter is still owned -
  // and that is wanted on sight rather than on a click, so the filter alone asks for it.
  const { data: unfiltered } = useQuery({
    queryKey: ['series', seriesName, null],
    queryFn: () => api.getSeriesByName(seriesName),
    enabled: status !== null,
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
  //
  // Split over shelves rather than editions: by the time the page draws, three trade
  // lines of one run are already one thing, and an annual is a shelf of its own.
  const { runs, annuals } = splitAnnuals(series.shelves)
  const grouped = annuals.length > 1
  const shown = grouped ? runs : series.shelves
  // A shelf the server did not count contributes nothing rather than an NaN subtitle.
  const annualIssues = annuals.reduce((n, s) => n + (s.bookCount ?? 0), 0)

  // Under a ?status= filter the listed editions are only a slice, so the confirm waits
  // for the unfiltered series rather than understating what it is about to delete.
  const scope = status ? unfiltered?.series : series
  // What is already shelved, and so is not news. Comic Vine ids only - an edition that
  // was never matched cannot be recognised in a Comic Vine answer either way.
  //
  // Both ids, because both are ways of owning a volume: the run you hold as issues, and
  // the run you hold as trades of it. Without the second, the page offers "The Amazing
  // Spider-Man (2022) · Find" directly under a shelf of that name. The cost, taken
  // knowingly: the offer to go and find that run as single issues goes with it.
  const ownedVolumeIds = (scope?.editions ?? [])
    .flatMap((e) => [e.comicvineId, e.collectsVolumeId])
    .filter((id): id is number => id != null)
  // Who publishes this series: whatever its editions say, which in a library organised
  // by series is one answer. The first is as good as any; a series split across two
  // publishers is a mis-grouping rather than a case to design for.
  const seriesPublisher = (scope?.editions ?? []).find((e) => e.publisher)?.publisher ?? null
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
        {shown.map((shelf) => (
          <CoverTile
            key={shelf.key}
            /* A shelf of several editions is a thing of its own and has a page of its
               own; a shelf of one is that edition, and goes on linking where it always
               did. volumeId carries exactly that distinction. */
            to={withStatus(
              shelf.volumeId == null ? `/edition/${shelf.editions[0].id}` : `/volume/${shelf.volumeId}`,
              status,
            )}
            state={back}
            /* The shelf has no art of its own, so it borrows the first edition's, the
               way the annuals tile borrows the first annual's. */
            img={`/api/editions/${shelf.editions[0].id}/thumbnail`}
            title={shelf.name}
            subtitle={`${shelf.bookCount} issue${shelf.bookCount === 1 ? '' : 's'}`}
          />
        ))}
        {grouped && (
          <CoverTile
            to={withStatus(`/series/${encodeURIComponent(seriesName)}/annuals`, status)}
            /* The first annual's cover, because the group has no art of its own and a
               blank box beside the run would read as a thumbnail that failed to load. */
            img={`/api/editions/${annuals[0].editions[0].id}/thumbnail`}
            title="Annuals"
            subtitle={`${annualIssues} issue${annualIssues === 1 ? '' : 's'}`}
          />
        )}
      </div>

      {/* Held back until the whole series is in hand: offering a volume as new because a
          filter is hiding the copy you own is worse than offering it a moment later. */}
      {scope && (
        <OtherVolumes
          series={series.name}
          ownedVolumeIds={ownedVolumeIds}
          publisher={seriesPublisher}
        />
      )}
    </div>
  )
}
