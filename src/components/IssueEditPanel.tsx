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
    mutationFn: (issueId: number) => api.applyIssue(book.id, issueId),
    onSuccess: () => { settled(); setMatching(false) },
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
        <button type="button" className="btn btn-ghost" onClick={() => setMatching(true)}>
          Fetch metadata
        </button>
      </div>

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
          onPick={(r) => apply.mutate(r.id)}
          onClose={() => setMatching(false)}
        />
      )}
    </div>
  )
}
