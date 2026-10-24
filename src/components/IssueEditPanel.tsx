import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiBook } from '../api'
import { buildCvQuery } from '../lib/cvQuery'
import MetadataEditor from './MetadataEditor'
import ComicVineMatchDialog from './ComicVineMatchDialog'

interface IssueEditPanelProps {
  book: ApiBook
  onClose: () => void
}

/**
 * Everything that can be done to a comic rather than said about it: correcting what is
 * known about it by hand, matching it against Comic Vine again, and moving it into another
 * edition when it landed in the wrong one.
 *
 * These were the comic's own page, which is gone - the run says everything that page said,
 * under the cover - so they live here, behind the pencil beside the issue's name. Behind
 * it rather than beside it: they are the rarest things on the page and the line under the
 * cover is already carrying what you came for.
 */
export default function IssueEditPanel({ book, onClose }: IssueEditPanelProps) {
  const qc = useQueryClient()
  const [matching, setMatching] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)

  // The editions to move into, which is also what names the one it is in now.
  const { data: editionsData, isLoading: editionsLoading } = useQuery({
    queryKey: ['editions'],
    queryFn: () => api.getEditions(),
  })

  // Everything here changes what the run is showing, so the run is re-read after each:
  // it carries which issues you hold and what they are called.
  const settled = () => {
    qc.invalidateQueries({ queryKey: ['book', book.id] })
    qc.invalidateQueries({ queryKey: ['edition'] })
    qc.invalidateQueries({ queryKey: ['edition-issues'] })
  }

  const save = useMutation({
    mutationFn: (form: Record<string, unknown>) => api.patchMetadata(book.id, form),
    onSuccess: () => { settled(); onClose() },
  })

  const apply = useMutation({
    mutationFn: ({ issueId, manual }: { issueId: number; manual?: boolean }) =>
      api.applyIssue(book.id, issueId, manual),
    onSuccess: () => { settled(); setMatching(false) },
  })

  // Opening the dialog clears the last apply's failure with it. The dialog unmounts on
  // close while this panel stays mounted, so without the reset a fresh open is greeted by
  // "Comic Vine has no issue with that id." about an id nobody has typed yet.
  function openMatch() {
    apply.reset()
    setMatching(true)
  }

  // Kept apart from `apply`: that one closes the match dialog and says nothing of its own,
  // while a refresh has to tell the user what it found. Comic Vine's record for a new comic
  // is often empty for days and an empty field never overwrites anything, so a refresh that
  // moved nothing is the likeliest outcome - and a bare "Refreshed" would read as though
  // Comic Vine had filled the record in. `changed` is what tells the two apart. No `manual`
  // flag: that is for a hand-typed id, and on a refresh it would re-stamp the reminder.
  const refresh = useMutation({
    mutationFn: (issueId: number) => api.applyIssue(book.id, issueId),
    onSuccess: settled,
  })

  const move = useMutation({
    mutationFn: (name: string) => api.moveBookEdition(book.id, name),
    onSuccess: () => {
      settled()
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      setMoveTarget(null)
    },
  })

  const currentEdition = editionsData?.editions?.find((e) => e.id === book.editionId)
  const currentEditionName = currentEdition?.name ?? `Edition #${book.editionId}`
  const moveValue = moveTarget ?? currentEditionName

  const editionField = (
    <div className="field">
      <label htmlFor="issue-edit-edition">Edition</label>
      <div className="move-edition-row">
        <input
          id="issue-edit-edition"
          list="issue-edit-editions"
          value={moveValue}
          onChange={(e) => setMoveTarget(e.target.value)}
        />
        <datalist id="issue-edit-editions">
          {editionsData?.editions?.map((e) => <option key={e.id} value={e.name} />)}
        </datalist>
        <button
          type="button"
          className="btn-ghost"
          disabled={move.isPending || editionsLoading || moveValue.trim() === currentEditionName}
          onClick={() => { const t = moveValue.trim(); if (t) move.mutate(t) }}
        >
          Move
        </button>
      </div>
      {move.isError && <p className="book-detail__move-error">Move failed: {move.error?.message}</p>}
    </div>
  )

  return (
    <div className="metadata-section issue-edit">
      <div className="issue-edit__head">
        <h3 className="metadata-section__heading">Edit metadata</h3>
        <button type="button" className="btn btn-ghost" onClick={openMatch}>
          Fetch metadata
        </button>
        {/* Only a comic already bound to a record has one to re-read. */}
        {book.comicvineId != null && (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={refresh.isPending}
            onClick={() => refresh.mutate(book.comicvineId as number)}
          >
            Refresh from Comic Vine
          </button>
        )}
      </div>
      {/* The §3.4 outcome: a hand-typed id during a Comic Vine outage answers 200 with the
          link bound and nothing else written. The dialog just closed and the comic looks
          untouched, so without this line the only sign is a Refresh button quietly
          appearing - indistinguishable from an apply that worked. */}
      {apply.isSuccess && apply.data?.metadataApplied === false && (
        <p className="issue-edit__refresh" role="status">
          The link is saved, but Comic Vine could not be read, so no metadata arrived. The
          comic is on the Settings list to re-check.
        </p>
      )}
      {refresh.isError && (
        <p className="issue-edit__refresh issue-edit__refresh--error" role="alert">
          Refresh failed: {refresh.error?.message}
        </p>
      )}
      {refresh.isSuccess && (
        <p className="issue-edit__refresh" role="status">
          {refresh.data.changed && refresh.data.changed.length > 0
            ? `Updated from Comic Vine: ${refresh.data.changed.join(', ')}.`
            : 'Comic Vine had nothing new for this comic.'}
        </p>
      )}

      <MetadataEditor
        book={book}
        onSave={(form) => save.mutate(form)}
        onCancel={onClose}
      >
        {editionField}
      </MetadataEditor>

      {matching && (
        <ComicVineMatchDialog
          defaultQuery={buildCvQuery(book, currentEdition)}
          // The server's own words, so a mistyped id reads as one ("Comic Vine has no issue
          // with that id.") rather than as a failure with no cause. The dialog stays open
          // on an error so the id can be corrected in place.
          error={apply.isError ? apply.error?.message : null}
          onPick={(r, opts) => apply.mutate({ issueId: r.id, manual: opts?.manual })}
          onClose={() => setMatching(false)}
        />
      )}
    </div>
  )
}
