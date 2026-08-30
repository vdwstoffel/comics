import { useState } from 'react'
import type { ReactNode } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import { enterFullscreen } from '../lib/useFullscreen'
import MetadataEditor from '../components/MetadataEditor'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog'

const CHARACTER_SHOW_THRESHOLD = 40

export default function BookDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)
  const [showAllCharacters, setShowAllCharacters] = useState(false)
  const [editing, setEditing] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id!) })
  const { data: editionsData, isLoading: editionsLoading } = useQuery({ queryKey: ['editions'], queryFn: () => api.getEditions() })

  const save = useMutation({
    mutationFn: (form: Record<string, unknown>) => api.patchMetadata(id!, form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book', id] }); setEditing(false) },
  })
  const apply = useMutation({
    mutationFn: (issueId: number) => api.applyIssue(id!, issueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book', id] }); setDialog(false) },
  })
  const moveEdition = useMutation({
    mutationFn: (name: string) => api.moveBookEdition(id!, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['book', id] })
      qc.invalidateQueries({ queryKey: ['editions'] })
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

  const currentEditionName = editionsData?.editions?.find((e) => e.id === book.editionId)?.name ?? `Edition #${book.editionId}`
  const moveValue = moveTarget ?? currentEditionName
  const metadataKey = [book.title, book.number, book.writer, book.penciller, book.date, book.summary].join('|')

  const visibleCharacters = showAllCharacters ? characters : characters.slice(0, CHARACTER_SHOW_THRESHOLD)
  const hasMoreCharacters = characters.length > CHARACTER_SHOW_THRESHOLD

  // Build a readable subtitle line from issue number, year, publisher
  const subtitleParts: string[] = []
  if (book.number) subtitleParts.push(`#${book.number}`)
  if (book.date) subtitleParts.push(book.date.slice(0, 4))
  if ((book as unknown as Record<string, string>).publisher) subtitleParts.push((book as unknown as Record<string, string>).publisher)

  // Read-mode detail rows: the editable metadata, minus what the header already shows
  const details: { label: string; value: ReactNode }[] = [
    { label: 'Edition', value: <Link to={`/edition/${book.editionId}`}>{currentEditionName}</Link> },
  ]
  if (book.writer) details.push({ label: 'Writer', value: book.writer })
  if (book.penciller) details.push({ label: 'Penciller', value: book.penciller })
  if (book.date) details.push({ label: 'Date', value: book.date })

  const editionMoveField = (
    <div className="field">
      <label>Edition</label>
      <div className="move-edition-row">
        <input
          list="edition-list"
          value={moveValue}
          onChange={(e) => setMoveTarget(e.target.value)}
        />
        <datalist id="edition-list">
          {editionsData?.editions?.map((e) => (
            <option key={e.id} value={e.name} />
          ))}
        </datalist>
        <button
          className="btn-ghost"
          disabled={moveEdition.isPending || editionsLoading || moveValue.trim() === currentEditionName}
          onClick={() => { const t = moveValue.trim(); if (t) moveEdition.mutate(t) }}
        >
          Move
        </button>
      </div>
      {moveEdition.isError && <p className="book-detail__move-error">Move failed: {moveEdition.error?.message}</p>}
    </div>
  )

  return (
    <div className="book-detail">
      {/* LEFT COLUMN: cover + actions + back link */}
      <div className="book-detail__left">
        <div className="book-detail__cover-frame">
          <img src={`/api/books/${id}/thumbnail`} alt="" className="book-detail__cover" />
        </div>
        <div className="btn-row book-detail__actions">
          <Link to={`/read/${id}`} onClick={enterFullscreen}><button className="btn">Read</button></Link>
          <button className="btn-ghost" onClick={() => setDialog(true)}>Fetch metadata</button>
        </div>
        <Link to={`/edition/${book.editionId}`} className="back-link">← Back to edition</Link>
      </div>

      {/* RIGHT COLUMN: title, summary + details (or the editor), creators, tags */}
      <div className="book-detail__main">
        <div className="book-detail__title-row">
          <h1 className="book-detail__title">{book.title || '(untitled)'}</h1>
          {!editing && (
            <button
              className="btn-icon"
              onClick={() => setEditing(true)}
              title="Edit metadata"
              aria-label="Edit metadata"
            >
              ✏
            </button>
          )}
        </div>
        {subtitleParts.length > 0 && (
          <p className="book-detail__subline">{subtitleParts.join(' · ')}</p>
        )}
        <p className="book-detail__meta">
          {book.pageCount} pages{book.comicinfoSynced ? ' · metadata embedded' : ''}
        </p>

        {editing ? (
          /* Metadata editor */
          <div className="metadata-section">
            <h3 className="metadata-section__heading">Edit metadata</h3>
            <MetadataEditor
              key={metadataKey}
              book={book}
              onSave={(form) => save.mutate(form)}
              onCancel={() => setEditing(false)}
            >
              {editionMoveField}
            </MetadataEditor>
          </div>
        ) : (
          <>
            {/* Summary first — the thing you actually want to read */}
            {book.summary && (
              <div className="book-detail__section">
                <h3 className="book-detail__section-heading">Summary</h3>
                <p className="book-detail__summary">{book.summary}</p>
              </div>
            )}

            {/* Details */}
            <div className="book-detail__section">
              <h3 className="book-detail__section-heading">Details</h3>
              {details.map((d) => (
                <div key={d.label} className="creator-row">
                  <span className="creator-row__role">{d.label}</span>
                  <span className="creator-row__names">{d.value}</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Creators */}
        {Object.keys(creditsByRole).length > 0 && (
          <div className="book-detail__section">
            <h3 className="book-detail__section-heading">Creators</h3>
            {Object.entries(creditsByRole).map(([role, names]) => (
              <div key={role} className="creator-row">
                <span className="creator-row__role">{role}</span>
                <span className="creator-row__names">{names.join(', ')}</span>
              </div>
            ))}
          </div>
        )}

        {/* Characters */}
        {characters.length > 0 && (
          <div className="book-detail__section">
            <h3 className="book-detail__section-heading">Characters</h3>
            <div className="chip-row">
              {visibleCharacters.map((c) => <span key={c} className="chip">{c}</span>)}
            </div>
            {hasMoreCharacters && (
              <button
                className="btn-ghost book-detail__show-toggle"
                onClick={() => setShowAllCharacters((v) => !v)}
              >
                {showAllCharacters
                  ? 'Show less'
                  : `Show all (${characters.length})`}
              </button>
            )}
          </div>
        )}

        {/* Teams */}
        {teams.length > 0 && (
          <div className="book-detail__section">
            <h3 className="book-detail__section-heading">Teams</h3>
            <div className="chip-row">
              {teams.map((t) => <span key={t} className="chip">{t}</span>)}
            </div>
          </div>
        )}

        {/* Story Arcs */}
        {storyArcs.length > 0 && (
          <div className="book-detail__section">
            <h3 className="book-detail__section-heading">Story Arcs</h3>
            <div className="chip-row">
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
