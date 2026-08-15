import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.js'
import MetadataEditor from '../components/MetadataEditor.jsx'
import ComicVineMatchDialog from '../components/ComicVineMatchDialog.jsx'

export default function BookDetail() {
  const { id } = useParams()
  const qc = useQueryClient()
  const [dialog, setDialog] = useState(false)
  const { data, isLoading } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id) })

  const save = useMutation({
    mutationFn: (form) => api.patchMetadata(id, form),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })
  const apply = useMutation({
    mutationFn: (issueId) => api.applyIssue(id, issueId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['book', id] }); setDialog(false) },
  })
  const embed = useMutation({
    mutationFn: () => api.embed(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['book', id] }),
  })

  if (isLoading) return <p>Loading…</p>
  const { book } = data
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
        <div className="metadata-section">
          <MetadataEditor key={metadataKey} book={book} onSave={(form) => save.mutate(form)} />
        </div>
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
