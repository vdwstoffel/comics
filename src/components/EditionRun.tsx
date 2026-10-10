import { useEffect, useRef, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { VolumeEntry } from '../lib/volumeEntries'
import type { UpcomingIssueForEdition } from '../lib/upcomingForEdition'
import { carouselStart } from '../lib/carouselStart'
import IssueCarousel from './IssueCarousel'
import IssueIdentity from './IssueIdentity'
import IssueDetail from './IssueDetail'
import EditionSidebar from './EditionSidebar'
import MissingIssueAction from './MissingIssueAction'
import ConfirmDeleteDialog from './ConfirmDeleteDialog'
import IssueEditPanel from './IssueEditPanel'

interface EditionRunProps {
  editionId: string
  /** What the edition is called, for the Edition row under the comic. */
  editionName: string
  entries: VolumeEntry[]
  /** What Find searches for on behalf of any gap in this run. */
  seriesName: string
  soon: UpcomingIssueForEdition[]
  /** How many gaps one press of Get all would actually take. */
  gettable: number
  onGetAll: () => void
  getAllPending: boolean
  /** Read the run from Comic Vine again. Absent when there is no run to re-read. */
  onRefresh?: () => void
  refreshing?: boolean
  stale?: boolean
  cvUrl?: string | null
}

/**
 * The run, one issue at a time: the comic you are on, what is known about it, and what the
 * run still owes you.
 *
 * The page opens on the first issue you have not finished, which on a thirty-five issue
 * volume is the difference between landing on what you want and scrolling to the bottom
 * for it. Everything else here follows from which issue is centred, which is why that one
 * number is the only state this holds.
 */
export default function EditionRun({
  editionId, editionName, entries, seriesName, soon, gettable, onGetAll, getAllPending,
  onRefresh, refreshing, stale, cvUrl,
}: EditionRunProps) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [editing, setEditing] = useState(false)
  // Which issue is centred lives in the url rather than in state, so that the browser
  // remembers it for us: stepping back into the run from the reader restores the entry
  // this page left behind, issue and all, with nothing to store or look up. It also makes
  // a link to one issue of a run something you can send.
  const [params, setParams] = useSearchParams()
  // What the opening choice was made from. A run that gains an issue mid-visit - a
  // download landing, a refresh - must not move the comic out from under you; only a run
  // that is a different run should choose again.
  const chosenFor = useRef<string | null>(null)

  const named = params.get('issue')
  // Either the entry's own key, or `book-<id>` for a comic named by the library's id for
  // it. The shelf knows a comic that way and not by Comic Vine's id for the issue it
  // fills, so closing a comic opened from the shelf asks for its run that way too.
  const namedBook = /^book-(\d+)$/.exec(named ?? '')
  const namedAt = entries.findIndex((e) => (
    e.key === named || (namedBook !== null && e.bookId === Number(namedBook[1]))
  ))
  // A bookmarked link to an issue a later run no longer has, or one typed by hand. The
  // opening rule is a better answer than a blank page.
  const at = namedAt !== -1 ? namedAt : carouselStart(entries)

  const move = (to: number) => {
    const next = new URLSearchParams(params)
    next.set('issue', entries[to].key)
    // Replace, never push. Walking a thirty-five issue run would otherwise leave
    // thirty-five entries behind it, and one press of back would step through them a
    // cover at a time instead of leaving the page.
    setParams(next, { replace: true })
  }

  const runKey = entries.map((e) => e.key).join('|')
  useEffect(() => {
    // Write the opening choice into the url once the run is known, so that the entry the
    // browser keeps for this page already names an issue before you leave it.
    if (entries.length === 0 || chosenFor.current === runKey) return
    chosenFor.current = runKey
    if (namedAt === -1) move(carouselStart(entries))
  })

  const current = entries[at]

  // The credits and tags, which the book list does not carry. Shares BookDetail's query
  // key, so arrowing to an issue you have already looked at costs nothing and opening its
  // page afterwards costs nothing either.
  const { data: detail } = useQuery({
    queryKey: ['book', current?.bookId],
    queryFn: () => api.getBook(current!.bookId!),
    enabled: current?.bookId != null,
  })

  // Where the issue falls in each arc it belongs to. Its own query, and deliberately not
  // prefetched for the neighbours: on a cold cache this costs a Comic Vine read, so it is
  // asked only about the issue you have settled on. Shares BookDetail's key, so arriving
  // at the issue's own page afterwards costs nothing.
  const { data: arcsData } = useQuery({
    queryKey: ['book-arcs', current?.bookId],
    queryFn: () => api.getBookArcs(current!.bookId!),
    enabled: current?.bookId != null,
    retry: false,
  })

  // Taking a comic off the disk without leaving the run. The issue's own page navigates
  // away afterwards because it has nowhere else to be; here the issue keeps its place and
  // turns back into a gap, with the way to fill it again - which is what you want in front
  // of you if you removed the wrong one.
  const remove = useMutation({
    mutationFn: (bookId: number) => api.deleteBook(bookId),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      qc.invalidateQueries({ queryKey: ['edition'] })
      // The run holds which of its issues you own, so it is now wrong. Nothing else
      // invalidates it: it is deliberately kept out of the 'edition' key, because it
      // carries Comic Vine's issue list too.
      qc.invalidateQueries({ queryKey: ['edition-issues'] })
      setConfirmRemove(false)
      // Nothing left to come back to if that was the edition's last comic.
      if (result.editionRemoved) navigate('/', { replace: true })
    },
  })

  // Walking a run is walking it in one direction, so the next issue's detail is almost
  // always the next thing wanted. Fetched quietly either side of where you are.
  useEffect(() => {
    for (const neighbour of [entries[at - 1], entries[at + 1]]) {
      if (neighbour?.bookId == null) continue
      const bookId = neighbour.bookId
      void qc.prefetchQuery({ queryKey: ['book', bookId], queryFn: () => api.getBook(bookId) })
    }
  }, [at, entries, qc])

  if (entries.length === 0 || !current) return null

  const missing = entries.filter((e) => !e.owned && e.issueId != null)

  // `offerUpload` is what separates the two places this is drawn. The centred issue is one
  // comic you are looking at, so it offers the file picker; the sidebar is a list of every
  // gap at once, where a picker per row is noise.
  const fill = (entry: VolumeEntry, offerUpload = false) => (
    <MissingIssueAction
      editionId={editionId}
      editionName={editionName}
      issueId={entry.issueId!}
      label={entry.label}
      match={entry.match}
      coverDate={entry.coverDate}
      seriesName={seriesName}
      offerUpload={offerUpload}
    />
  )

  const gap = !current.owned && current.issueId != null

  return (
    <div className="edition-run">
      <div className="edition-run__main">
        <IssueCarousel
          entries={entries.map((e) => ({
            key: e.key,
            label: e.label,
            coverUrl: e.coverUrl,
            readState: e.readState,
            percent: e.percent,
            readTo: e.readTo,
          }))}
          index={at}
          onMove={move}
          action={gap ? fill(current, true) : undefined}
        />

        <div className="edition-run__identity" data-testid="issue-identity">
          <IssueIdentity
            label={current.label}
            title={current.title}
            date={current.date ?? current.coverDate}
            year={current.year}
            publisher={current.publisher}
            comicinfoSynced={current.comicinfoSynced}
            pageCount={current.pageCount}
            readState={current.readState}
            percent={current.percent}
            onEdit={current.bookId != null ? () => setEditing(true) : undefined}
            onRemove={current.bookId != null ? () => setConfirmRemove(true) : undefined}
          />
        </div>

        {/* The comic's own page is gone, so what it could do to a comic is done here.
            Only once the comic itself has arrived: the editor is filled from it. */}
        {editing && detail?.book && (
          <IssueEditPanel book={detail.book} onClose={() => setEditing(false)} />
        )}

        <div className="edition-run__detail">
          <IssueDetail
            bookId={current.bookId}
            credits={detail?.credits}
            tags={detail?.tags}
            summary={current.summary}
            writer={current.writer}
            penciller={current.penciller}
            date={current.date ?? current.coverDate}
            editionId={current.bookId != null ? Number(editionId) : undefined}
            editionName={current.bookId != null ? editionName : undefined}
            arcs={arcsData?.arcs}
          />
        </div>
      </div>

      {confirmRemove && current.bookId != null && (
        <ConfirmDeleteDialog
          what={`"${current.title || current.label}"`}
          fileCount={1}
          deleting={remove.isPending}
          error={remove.isError ? `Remove failed: ${remove.error?.message}` : null}
          onConfirm={() => remove.mutate(current.bookId!)}
          onClose={() => setConfirmRemove(false)}
        />
      )}

      <EditionSidebar
        missing={missing.map((e) => ({ id: e.issueId!, label: e.label }))}
        soon={soon}
        gettable={gettable}
        onGetAll={onGetAll}
        getAllPending={getAllPending}
        onRefresh={onRefresh}
        refreshing={refreshing}
        stale={stale}
        cvUrl={cvUrl}
        renderAction={(issueId) => {
          const entry = missing.find((e) => e.issueId === issueId)
          return entry ? fill(entry) : null
        }}
      />
    </div>
  )
}
