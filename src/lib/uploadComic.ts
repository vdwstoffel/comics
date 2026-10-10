import type { ApiBook } from '../api'

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
}

/**
 * Send one comic to the library, reporting how far it has got.
 *
 * XMLHttpRequest rather than fetch for the one thing fetch still cannot do: tell you how
 * much of the body has gone. Shared rather than written at each call site so that the
 * run's grid and its carousel cannot drift into uploading two different ways.
 */
export function uploadComic({ file, edition, issueId, onProgress }: UploadComicInput): Promise<UploadComicResult> {
  const form = new FormData()
  if (edition) form.set('edition', edition)
  if (issueId != null) form.set('issueId', String(issueId))
  form.set('file', file, file.name)

  return new Promise<UploadComicResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/upload')
    xhr.upload.onprogress = (ev) => {
      // A length the browser cannot work out would report NaN%, which is worse than
      // reporting nothing.
      if (ev.lengthComputable) onProgress?.(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      // 413 is what the size limit answers with. Treating it as success would close the
      // gap on the page for a comic that was never stored.
      if (xhr.status !== 200) { reject(new Error(`Upload failed (${xhr.status})`)); return }
      // The file is on disk by the time the body is written, so an answer we cannot read
      // costs only what we can say about it afterwards - never the comic.
      try { resolve(JSON.parse(xhr.responseText) as UploadComicResult) } catch { resolve({}) }
    }
    xhr.onerror = () => reject(new Error('Upload failed'))
    xhr.send(form)
  })
}
