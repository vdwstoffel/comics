import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { ApiMetadataFollowup } from '../api'

/**
 * The follow-up list with its Refresh and Dismiss behaviour.
 *
 * It used to take a `pageSize`, because the copy inside Settings sat above the other
 * sections and sixteen rows pushed them off the screen. Settings is a sidebar now and the
 * list has a pane to itself with nothing under it, so there is nothing left to bury and
 * every row is drawn.
 *
 * Renders nothing when the list is empty, including while loading, so the caller decides
 * what an empty state should say.
 */
export function FollowupList() {
  const qc = useQueryClient()
  // Same key as every other reader of the list, so they share one cache entry.
  const { data: followupData } = useQuery({
    queryKey: ['metadata-followups'], queryFn: api.metadataFollowups,
  })
  const followups = followupData?.followups ?? []

  // Refresh and Dismiss both change what the list should say, so both reconcile it.
  // A refresh also rewrites the book, so both its own cache and the library list (where
  // a summary Comic Vine has finally filled in would show next) are stale too.
  const refreshFollowup = useMutation({
    // The book's CURRENT id, never the one that was typed. They drift apart when the comic
    // is later matched through search; posting the old number would silently re-bind it
    // and discard that correction. No `manual` flag either: a refresh is not a new
    // hand-entry, and sending it would re-stamp the provenance row.
    mutationFn: (f: ApiMetadataFollowup) => api.applyIssue(f.bookId, f.bookCvId as number),
    onSuccess: (_res, f) => {
      qc.invalidateQueries({ queryKey: ['metadata-followups'] })
      qc.invalidateQueries({ queryKey: ['book', f.bookId] })
      qc.invalidateQueries({ queryKey: ['library-books'] })
    },
  })

  // Drops the note only. The comic keeps its Comic Vine id, its metadata and its file:
  // this is a sticky note coming down, not an edit to the comic.
  const dismissFollowup = useMutation({
    mutationFn: (bookId: number) => api.dismissFollowup(bookId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['metadata-followups'] }),
  })

  if (followups.length === 0) return null

  return (
    <div className="followups">
      <p className="settings__hint">
        These comics are missing something. Comic Vine is often empty for days after
        a comic comes out, so Refresh reads the record again; Dismiss takes the note
        down and leaves the comic exactly as it is.
      </p>
      {/* The server says WHOSE failure it was - Comic Vine unreachable, or an id
          Comic Vine does not have - because those have different fixes. What is
          true of both is added here: a failed refresh writes nothing, so the comic
          is still listed and the work is not lost. During an outage this is the
          message the user sees most, and it must not read as a fault in Comix. */}
      {refreshFollowup.isError && (
        <p className="error-text">
          {(refreshFollowup.error as Error).message}{' '}
          Nothing was changed, so the comic stays on this list.
        </p>
      )}
      <ul className="followups__list">
        {followups.map((f) => <FollowupRow
          key={f.bookId}
          followup={f}
          busy={refreshFollowup.isPending || dismissFollowup.isPending}
          onRefresh={() => refreshFollowup.mutate(f)}
          onDismiss={() => dismissFollowup.mutate(f.bookId)}
        />)}
      </ul>
    </div>
  )
}

const day = (iso: string) => new Date(iso).toLocaleDateString()

// The hand-typed context, as one line: how the comic came to be bound, and what Comic
// Vine itself was still missing when it was last read. Context only - the row is on the
// list because of what the BOOK lacks, which the line above it already named. A comic
// with no entry here was matched some other way and says nothing.
function manualNote(f: ApiMetadataFollowup): string | null {
  if (!f.manual) return null
  const parts = ['Linked by hand']
  // Only when they differ: repeating the id the row already shows would be noise, and
  // when they differ a Refresh acts on the current one, so the row must not imply
  // otherwise.
  if (f.typedIssueId !== null && f.typedIssueId !== f.bookCvId) parts.push(`typed ${f.typedIssueId}`)
  // Never read is its own state, not a flavour of "nothing was missing": it means Comic
  // Vine has not answered once since the id was typed, which is the usual case during
  // the outage that made someone type it.
  parts.push(f.checkedAt ? `Comic Vine read ${day(f.checkedAt)}` : 'Comic Vine never read')
  if (f.cvMissing.length > 0) parts.push(`Comic Vine had no ${f.cvMissing.join(', ')}`)
  return parts.join(' · ')
}

function FollowupRow({ followup: f, busy, onRefresh, onDismiss }: {
  followup: ApiMetadataFollowup
  busy: boolean
  onRefresh: () => void
  onDismiss: () => void
}) {
  const name = f.title ?? f.fileName
  const note = manualNote(f)
  return (
    <li className="followups__row">
      <div className="followups__main">
        <Link to={`/book/${f.bookId}`}>{name}</Link>
        {' '}
        {/* The id the Refresh button would act on, linked where we hold its Comic Vine
            page - so the record can be checked before deciding the comic is hopeless. */}
        {f.bookCvId !== null && (f.cvSiteUrl
          ? <a href={f.cvSiteUrl} target="_blank" rel="noreferrer">{f.bookCvId}</a>
          : <span>{f.bookCvId}</span>)}
        {/* Naming the holes is what makes the list judgeable: a reader who disagrees with
            the rule can see which field put a comic here rather than guess. */}
        <p className="followups__missing">Missing: {f.missing.join(', ')}</p>
        {note && <p className="followups__note">{note}</p>}
        {/* Nothing to re-read. The row says so instead of offering a button that cannot
            work: an explanation beats a control that looks broken. */}
        {f.bookCvId === null && (
          <p className="followups__note">
            Not linked to Comic Vine, so there is nothing to re-read — match it from the
            comic's own page.
          </p>
        )}
        <p className="settings__hint">Added {day(f.addedAt)}</p>
      </div>
      <div className="followups__actions">
        {f.bookCvId !== null && (
          <button
            className="btn"
            type="button"
            onClick={onRefresh}
            disabled={busy}
            aria-label={`Refresh ${name} from Comic Vine`}
          >
            Refresh
          </button>
        )}
        <button
          className="btn"
          type="button"
          onClick={onDismiss}
          disabled={busy}
          aria-label={`Dismiss ${name} from this list`}
        >
          Dismiss
        </button>
      </div>
    </li>
  )
}
