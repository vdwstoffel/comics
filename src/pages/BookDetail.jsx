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
    <div style={{ padding: 16, display: 'flex', gap: 24 }}>
      <img src={`/api/books/${id}/thumbnail`} alt="" width={240} style={{ borderRadius: 8, alignSelf: 'flex-start' }} />
      <div style={{ flex: 1 }}>
        <h1>{book.title || '(untitled)'}</h1>
        <p>{book.pageCount} pages{book.comicinfoSynced ? ' · metadata embedded' : ''}</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <Link to={`/read/${id}`}><button>Read</button></Link>
          <button onClick={() => setDialog(true)}>Fetch metadata</button>
          <button onClick={() => embed.mutate()} disabled={embed.isPending}>Embed into file</button>
        </div>
        {embed.isError && <p style={{ color: 'red' }}>Embed failed: {embed.error?.message ?? 'Unknown error'}</p>}
        <MetadataEditor key={metadataKey} book={book} onSave={(form) => save.mutate(form)} />
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
