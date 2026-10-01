import { useEffect, useState, useRef } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import { useFullscreen } from '../lib/useFullscreen'
import { useZoom } from '../lib/useZoom'

export default function Reader() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  // React Router names the first entry of a history stack 'default', so anything else
  // means there is a page behind this one to go back to. Which page is the point: the
  // carousel opens a comic directly, and sending you to the issue's own page on the way
  // out dropped you somewhere you had never been and two presses from the run.
  const cameFromSomewhere = location.key !== 'default'
  // The shelf asks for something else: it opens a comic with no run and no issue page on
  // the way in, and stepping back onto it would put you among the comics you have not read
  // yet - including the one you just did, until the shelf catches up. Closing the comic
  // leaves you in its run instead, standing on it.
  const toRun = (location.state as { back?: string } | null)?.back === 'run'
  const { data } = useQuery({ queryKey: ['book', id], queryFn: () => api.getBook(id!) })
  const [page, setPage] = useState<number | null>(null)
  const [scrubbing, setScrubbing] = useState<number | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const zoom = useZoom()
  const { isFullscreen, enter, exit, toggle } = useFullscreen()

  // Reading takes the whole screen, and gives it back on the way out.
  useEffect(() => {
    enter()
    return exit
  }, [enter, exit])

  // A new page opens whole. Arriving on it zoomed into a corner of the last one is
  // disorienting, and there is no reason to think the interesting part is in the same
  // place twice.
  useEffect(() => { zoom.reset() }, [page, zoom.reset])

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
  // The run this comic belongs to, open on this comic. `book-<id>` is a selector the
  // carousel understands for an issue it holds, whether or not Comic Vine lists it.
  //
  // Where back goes when there is no history to step through, as well as where the shelf
  // asks it to go: the comic's own page is gone, so the run is the only place a comic is.
  const run = `/edition/${data.book.editionId}?issue=book-${id}`
  const runBack = toRun ? run : null
  const displayPage = scrubbing ?? page
  return (
    <div className="reader-root">
      {/* A real link, so middle-click and "open in new tab" still work and a comic opened
          cold from a bookmark has somewhere to go. The click goes back instead whenever
          there is a back to go to and nowhere particular it was asked to end up.

          Replacing rather than pushing on the way to the run: the reader is behind you,
          and leaving it in the history would make the browser's own back button re-open
          the comic you just closed. */}
      <Link
        to={run}
        replace={runBack !== null}
        className="reader-back"
        aria-label="Back"
        onClick={(e) => {
          if (runBack || !cameFromSomewhere) return
          e.preventDefault()
          navigate(-1)
        }}
      >
        ←
      </Link>
      <div className="reader-viewport" ref={zoom.ref} {...zoom.handlers}>
        <img
          src={`/api/books/${id}/pages/${page}`}
          alt={`page ${page + 1}`}
          style={zoom.transform ? { transform: zoom.transform } : undefined}
          draggable={false}
        />
        {page + 1 < total && <img src={`/api/books/${id}/pages/${page + 1}`} alt="" style={{ display: 'none' }} />}
        {/* The turn zones cover the left and right thirds. Zoomed in, a pan crosses them,
            so they stand down and pages turn by key or scrubber until you zoom back out. */}
        <button aria-label="previous" disabled={zoom.zoomed}
          onClick={() => setPage((p) => Math.max((p ?? 0) - 1, 0))}
          className="reader-zone reader-zone--prev" />
        <button aria-label="next" disabled={zoom.zoomed}
          onClick={() => setPage((p) => Math.min((p ?? 0) + 1, total - 1))}
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
