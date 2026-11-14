import type { ApiBook, StagedCollection } from '../api'

export interface UploadComicInput {
  file: File
  /**
   * The edition's NAME, which is what the server files a comic by. Without one the comic
   * lands under "Unsorted" rather than in the run, so a caller that knows the run must
   * say so.
   */
  edition?: string
  /** Comic Vine's id for the issue this file fills. What the metadata is read from. */
  issueId?: number
  /**
   * The two halves of the file name, when the caller already knows them. Supplying both
   * spares the server a getIssue and a getVolume whose only job is to look them up - which
   * matters at forty comics a batch, against Comic Vine's 200 requests an hour.
   */
  volumeName?: string
  issueNumber?: string
  /**
   * The comic this upload replaces. The server deletes it only once this file has landed
   * safely, so a failed upload never costs you the comic you already had.
   */
  replaceBookId?: number
  /** Whole percent uploaded. A comic is tens of megabytes; a silent button reads as a dead one. */
  onProgress?: (percent: number) => void
}

export interface UploadComicResult {
  book?: ApiBook
  /**
   * Whether Comic Vine answered. Absent when nothing was asked of it. False means the
   * comic landed but carries only what its file said - worth saying out loud, because
   * the point of uploading into a gap was the metadata.
   */
  metadataApplied?: boolean
  /** The name the comic asked for, before a collision may have forced another. */
  wantedName?: string
  /** Present only when this upload replaced a comic, which deleted that comic. */
  replaced?: { bookId: number; editionRemoved: boolean }
  /**
   * The comic landed, but the one it was meant to replace could not be removed. The
   * upload succeeded - this says the old copy is probably still there.
   */
  replaceFailed?: boolean
  /**
   * What was sent was a zip of several comics, so none was stored: they are waiting in
   * this collection for review. Every caller that accepts a .zip has to say so, or the
   * upload reads as done with nothing to show for it.
   */
  collection?: StagedCollection
}

/**
 * Send one comic to the library, reporting how far it has got.
 *
 * XMLHttpRequest rather than fetch for the one thing fetch still cannot do: tell you how
 * much of the body has gone. Shared rather than written at each call site so that the
 * run's grid and its carousel cannot drift into uploading two different ways.
 */
export function uploadComic({ file, edition, issueId, volumeName, issueNumber, replaceBookId, onProgress }: UploadComicInput): Promise<UploadComicResult> {
  const form = new FormData()
  if (edition) form.set('edition', edition)
  if (issueId != null) form.set('issueId', String(issueId))
  // Both or neither: half of a name is not a name.
  if (volumeName && issueNumber) {
    form.set('volumeName', volumeName)
    form.set('issueNumber', issueNumber)
  }
  if (replaceBookId != null) form.set('replaceBookId', String(replaceBookId))
  form.set('file', file, file.name)
  return send<UploadComicResult>('/api/upload', form, onProgress)
}

/**
 * Send a zip from your own disk to be unpacked and held for review - even a zip of one
 * comic, which /api/upload would store straight away. With `collectionId` it joins that
 * collection instead: a part a bot check stopped, handed back by hand.
 */
export function stageCollection({ file, collectionId, onProgress }: {
  file: File
  collectionId?: number
  onProgress?: (percent: number) => void
}): Promise<{ collection: StagedCollection }> {
  const form = new FormData()
  // Ahead of the file, as every field is: the server reads the parts in order.
  if (collectionId != null) form.set('collectionId', String(collectionId))
  form.set('file', file, file.name)
  return send('/api/collections', form, onProgress)
}

/**
 * File one comic out of a collection: the fields an upload carries, naming a file already
 * on the server instead of sending one, and answered the way an upload is.
 */
export async function fileStagedComic(
  collectionId: number,
  { file, edition, issueId, volumeName, issueNumber, replaceBookId }: Omit<UploadComicInput, 'file' | 'onProgress'> & { file: string },
): Promise<UploadComicResult & { remaining: number }> {
  const res = await fetch(`/api/collections/${collectionId}/file`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      file, edition, issueId,
      ...(volumeName && issueNumber ? { volumeName, issueNumber } : {}),
      replaceBookId,
    }),
  })
  let body: (UploadComicResult & { remaining: number; error?: string }) | null = null
  try { body = await res.json() } catch { /* an answer we cannot read */ }
  if (!res.ok) throw new Error(body?.error || `Filing failed (${res.status})`)
  return body ?? { remaining: -1 }
}

function send<T>(url: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    xhr.upload.onprogress = (ev) => {
      // A length the browser cannot work out would report NaN%, which is worse than
      // reporting nothing.
      if (ev.lengthComputable) onProgress?.(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      // 413 is what the size limit answers with. Treating it as success would close the
      // gap on the page for a comic that was never stored.
      if (xhr.status !== 200) {
        // The server's own reason where it gave one - "that zip holds no comics" is the
        // whole answer to why a zip was refused, and a bare status throws it away.
        let reason: string | undefined
        try { reason = (JSON.parse(xhr.responseText) as { error?: string }).error } catch { /* none */ }
        reject(new Error(reason ? `${reason} (${xhr.status})` : `Upload failed (${xhr.status})`))
        return
      }
      // The file is on disk by the time the body is written, so an answer we cannot read
      // costs only what we can say about it afterwards - never the comic.
      try { resolve(JSON.parse(xhr.responseText) as T) } catch { resolve({} as T) }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(form)
  })
}
