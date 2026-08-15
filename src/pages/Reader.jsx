import { useEffect, useState, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api.js'

export default function Reader() {
  const { id } = useParams()
  const { data } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id) })
  const [page, setPage] = useState(null)
  const saveTimer = useRef(null)

  // Resume at last-read page once the book loads.
  useEffect(() => {
    if (data && page === null) setPage(data.progress.lastPage || 0)
  }, [data, page])

  // Debounced progress save whenever the page changes.
  useEffect(() => {
    if (data == null || page === null) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.putProgress(id, { lastPage: page, completed: page >= data.book.pageCount - 1 }).catch(() => {})
    }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [page, data, id])

  useEffect(() => {
    if (data == null) return
    const onKey = (e) => {
      if (e.key === 'ArrowRight') setPage((p) => Math.min((p ?? 0) + 1, data.book.pageCount - 1))
      if (e.key === 'ArrowLeft') setPage((p) => Math.max((p ?? 0) - 1, 0))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data])

  if (!data || page === null) return <p>Loading…</p>
  const total = data.book.pageCount
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', display: 'grid', gridTemplateRows: '1fr auto' }}>
      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <img src={`/api/books/${id}/pages/${page}`} alt={`page ${page + 1}`}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        {page + 1 < total && <img src={`/api/books/${id}/pages/${page + 1}`} alt="" style={{ display: 'none' }} />}
        <button aria-label="previous" onClick={() => setPage((p) => Math.max(p - 1, 0))}
          style={{ position: 'absolute', left: 0, top: 0, width: '35%', height: '100%', opacity: 0, cursor: 'w-resize' }} />
        <button aria-label="next" onClick={() => setPage((p) => Math.min(p + 1, total - 1))}
          style={{ position: 'absolute', right: 0, top: 0, width: '35%', height: '100%', opacity: 0, cursor: 'e-resize' }} />
      </div>
      <div style={{ color: '#fff', textAlign: 'center', padding: 8 }}>{page + 1} / {total}</div>
    </div>
  )
}
