import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { uploadComic } from '../lib/uploadComic'

export interface IssueUploadActionProps {
  /**
   * What the run is called. The server files a comic by the edition's NAME, and without
   * one it lands under "Unsorted" instead of in the run - so this control is only offered
   * where the name is actually known.
   */
  editionName: string
  /** Comic Vine's id for the gap this fills, and what its metadata is read from. */
  issueId: number
  /** `#256`, the comic this acts on. Carried as the control's accessible name. */
  label: string
}

/**
 * Filling a gap from a file you already have.
 *
 * The other half of the offer beside it: Get fetches the one scraped release that is this
 * issue, and this takes the comic from your disk when there is no such release - or when
 * you would rather not wait for one. What makes it worth a button here rather than a trip
 * to the Upload page is that the run and the issue are already known, so there is nothing
 * to type and nothing to match: the file goes straight into this edition and its metadata
 * is read from Comic Vine's own id for the issue rather than guessed from the file name.
 * That makes this the second import path - Get is the other - where the comic's identity
 * is known rather than inferred.
 *
 * A label around a hidden input rather than a button, because a button cannot open a file
 * picker on its own and the two would then have to be kept in step by hand.
 */
export default function IssueUploadAction({ editionName, issueId, label }: IssueUploadActionProps) {
  const qc = useQueryClient()
  const [percent, setPercent] = useState<number | null>(null)

  const upload = useMutation({
    mutationFn: (file: File) => uploadComic({
      file,
      edition: editionName,
      issueId,
      onProgress: setPercent,
    }),
    onSuccess: () => {
      setPercent(null)
      // The run owns this issue now, so every shelf that counted it as missing is wrong
      // until it is asked again. The same set the download path and a removal invalidate:
      // the run holds which of its issues you own separately from Comic Vine's list.
      qc.invalidateQueries({ queryKey: ['editions'] })
      qc.invalidateQueries({ queryKey: ['series'] })
      qc.invalidateQueries({ queryKey: ['edition'] })
      qc.invalidateQueries({ queryKey: ['edition-issues'] })
    },
    onError: () => setPercent(null),
  })

  function choose(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Picking the same file twice is a real thing to do after a failure, and the input
    // fires nothing on an unchanged value.
    e.target.value = ''
    if (file) upload.mutate(file)
  }

  const busy = upload.isPending
  // The percent only arrives once the first chunk has gone; until then there is a request
  // in flight with nothing to say about it yet.
  const text = busy ? `Uploading… ${percent ?? 0}%` : '↑ Upload'

  return (
    <>
      <label className="btn btn-ghost volume-issue__upload">
        {text}
        <input
          type="file"
          accept=".cbz,.cbr"
          className="volume-issue__file"
          aria-label={busy ? `Uploading ${label}` : `Upload ${label}`}
          disabled={busy}
          onChange={choose}
        />
      </label>
      {upload.isError && <span className="volume-issue__error">Could not upload that one.</span>}
      {upload.data?.metadataApplied === false && (
        <span className="volume-issue__error">Uploaded, but the metadata could not be applied.</span>
      )}
    </>
  )
}
