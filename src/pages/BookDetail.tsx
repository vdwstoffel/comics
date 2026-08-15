import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import MetadataEditor from '../components/MetadataEditor'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog'

export default function BookDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)

  const { data, isLoading } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id!) })
  const { data: seriesData, isLoading: seriesLoading } = useQuery({ queryKey: ['series'], queryFn: () => api.getSeries() })

  const save = useMutation({
    mutationFn: (form: Record<string, unknown>) => api.patchMetadata(id!, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })
  const apply = useMutation({
    mutationFn: (issueId: number) => api.applyIssue(id!, issueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book', id] }); setDialog(false) },
  })
  const embed = useMutation({
    mutationFn: () => api.embed(id!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })
  const moveSeries = useMutation({
    mutationFn: (name: string) => api.moveBookSeries(id!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', id] })
      qc.invalidateQueries({ queryKey: ['series'] })
      setMoveTarget(null)
    },
  })

  if (isLoading) return <p>Loading…</p>
  if (!data) return null
  const { book, credits = [], tags = [] } = data

  // Group credits by role
  const creditsByRole = credits.reduce<Record<string, string[]>>((acc, c) => {
    const key = c.role.charAt(0).toUpperCase() + c.role.slice(1)
    ;(acc[key] = acc[key] || []).push(c.name)
    return acc
  }, {})

  const characters = tags.filter((t) => t.kind === 'character').map((t) => t.value)
  const teams = tags.filter((t) => t.kind === 'team').map((t) => t.value)
  const storyArcs = tags.filter((t) => t.kind === 'story_arc').map((t) => t.value)

  const currentSeriesName = seriesData?.series?.find((s) => s.id === book.seriesId)?.name ?? `Series #${book.seriesId}`
  const moveValue = moveTarget ?? currentSeriesName
  const metadataKey = [book.title, book.number, book.writer, book.penciller, book.date, book.summary].join('|')

  return (
    <div className="book-detail">
      <img src={`/api/books/${id}/thumbnail`} alt="" className="book-detail__cover" />
      <div className="book-detail__info">
        <h1 className="book-detail__title">{book.title || '(untitled)'}</h1>
        <p className="book-detail__meta">
          {book.pageCount} pages{book.comicinfoSynced ? ' · metadata embedded' : ''}
        </p>
        <div className="btn-row">
          <Link to={`/read/${id}`}><button className="btn">Read</button></Link>
          <button className="btn-ghost" onClick={() => setDialog(true)}>Fetch metadata</button>
          <button className="btn-ghost" onClick={() => embed.mutate()} disabled={embed.isPending}>Embed into file</button>
        </div>
        {embed.isError && <p className="book-detail__error">Embed failed: {embed.error?.message ?? 'Unknown error'}</p>}

        <div className="field">
          <label>Series</label>
          <div className="move-series-row">
            <input
              list="series-list"
              value={moveValue}
              onChange={(e) => setMoveTarget(e.target.value)}
            />
            <datalist id="series-list">
              {seriesData?.series?.map((s) => (
                <option key={s.id} value={s.name} />
              ))}
            </datalist>
            <button
              className="btn-ghost"
              disabled={moveSeries.isPending || seriesLoading || moveValue.trim() === currentSeriesName}
              onClick={() => { const t = moveValue.trim(); if (t) moveSeries.mutate(t) }}
            >
              Move
            </button>
          </div>
          {moveSeries.isError && <p className="book-detail__move-error">Move failed: {moveSeries.error?.message}</p>}
        </div>

        <div className="metadata-section">
          <MetadataEditor key={metadataKey} book={book} onSave={(form) => save.mutate(form)} />
        </div>

        {Object.keys(creditsByRole).length > 0 && (
          <div className="book-detail__credits">
            <h3>Creators</h3>
            {Object.entries(creditsByRole).map(([role, names]) => (
              <p key={role} className="book-detail__credit-row">
                <strong>{role}:</strong> {names.join(', ')}
              </p>
            ))}
          </div>
        )}

        {characters.length > 0 && (
          <div className="book-detail__tags">
            <h3>Characters</h3>
            <div className="book-detail__chips">
              {characters.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
          </div>
        )}

        {teams.length > 0 && (
          <div className="book-detail__tags">
            <h3>Teams</h3>
            <div className="book-detail__chips">
              {teams.map((t) => <span key={t} className="chip">{t}</span>)}
            </div>
          </div>
        )}

        {storyArcs.length > 0 && (
          <div className="book-detail__tags">
            <h3>Story Arcs</h3>
            <div className="book-detail__chips">
              {storyArcs.map((a) => <span key={a} className="chip">{a}</span>)}
            </div>
          </div>
        )}
      </div>
      {dialog && (
        <ComicVineMatchDialog
          defaultQuery={book.title}
          onPick={(r) => apply.mutate(r.id)}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  )
}
