import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useFullscreen } from '../lib/useFullscreen'

export default function Reader() {
  const { id } = useParams()
  const { data } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id!) })
  const [page, setPage] = useState<number | null>(null)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const { isFullscreen, enter, exit, toggle } = useFullscreen()

  // Reading takes the whole screen, and gives it back on the way out.
  useEffect(() => {
    enter()
    return exit
  }, [enter, exit])

  // Resume at last-read page once the book loads.
  useEffect(() => {
    if (data && page === null) setPage(data.progress.lastPage || 0)
  }, [data, page])

  // Debounced progress save whenever the page changes.
  useEffect(() => {
    if (data == null || page === null) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.putProgress(id!, { lastPage: page, completed: page >= data.book.pageCount - 1 }).catch(() => {})
    }, 400)
    return () => clearTimeout(saveTimer.current)
  }, [page, data, id])

  useEffect(() => {
    if (data == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPage((p) => Math.min((p ?? 0) + 1, data.book.pageCount - 1))
      if (e.key === 'ArrowLeft') setPage((p) => Math.max((p ?? 0) - 1, 0))
      if (e.key === 'f') toggle()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [data, toggle])

  if (!data || page === null) return <p>Loading…</p>
  const total = data.book.pageCount
  const displayPage = scrubbing ?? page
  return (
    <div className="reader-root">
      <Link to={`/book/${id}`} className="reader-back" aria-label="Back">←</Link>
      <div className="reader-viewport">
        <img src={`/api/books/${id}/pages/${page}`} alt={`page ${page + 1}`} />
        {page + 1 < total && <img src={`/api/books/${id}/pages/${page + 1}`} alt="" style={{ display: 'none' }} />}
        <button aria-label="previous" onClick={() => setPage((p) => Math.max((p ?? 0) - 1, 0))}
          className="reader-zone reader-zone--prev" />
        <button aria-label="next" onClick={() => setPage((p) => Math.min((p ?? 0) + 1, total - 1))}
          className="reader-zone reader-zone--next" />
      </div>
      <div className="reader-bottom-bar">
        <input
          type="range"
          className="reader-scrubber"
          min={0}
          max={total - 1}
          step={1}
          value={displayPage}
          aria-label="Go to page"
          onInput={(e) => setScrubbing(Number((e.target as HTMLInputElement).value))}
          onChange={(e) => {
            const v = Number(e.target.value)
            setPage(v)
            setScrubbing(null)
          }}
        />
        <span className="reader-counter">{displayPage + 1} / {total}</span>
        <button
          className="reader-fullscreen"
          onClick={toggle}
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          title={isFullscreen ? 'Exit fullscreen (f)' : 'Enter fullscreen (f)'}
        >{isFullscreen ? '⤡' : '⤢'}</button>
      </div>
    </div>
  )
}
