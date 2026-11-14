import { useEffect, useState } from 'react'
import type { PostDownloads, PostPart } from '../api'

export interface PostPartsDialogProps {
  post: PostDownloads
  /** Queue the parts left ticked. */
  onDownload: (parts: PostPart[]) => void
  onClose: () => void
  pending?: boolean
  error?: string | null
}

/**
 * The parts a post splits a run into, each under the heading the post gives it, to choose
 * from before anything downloads.
 *
 * All ticked, because the usual answer is the whole run. Unticking is for the part you do
 * not want - Daredevil's "#1 – Director's Cut" beside the run proper - or a stretch you
 * already have, which would otherwise be downloaded only to be skipped as already yours.
 * Whatever is left ticked lands in one collection and is reviewed in one table.
 */
export default function PostPartsDialog({ post, onDownload, onClose, pending = false, error = null }: PostPartsDialogProps) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(post.parts.map((p) => p.url)))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  function toggle(url: string) {
    setTicked((prev) => {
      const next = new Set(prev)
      if (!next.delete(url)) next.add(url)
      return next
    })
  }

  const chosen = post.parts.filter((p) => ticked.has(p.url))

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* Clicks inside the panel must not reach the backdrop's close handler. */}
      <div className="modal-panel" role="dialog" aria-label={post.title ?? 'Download'} onClick={(e) => e.stopPropagation()}>
        <h3>{post.title ?? 'Download'}</h3>
        <p className="modal-detail">
          {post.parts.length} part{post.parts.length === 1 ? '' : 's'}
          {post.size && <> · {post.size}</>}
          {' '}· everything you keep ticked is reviewed together once it has landed.
        </p>

        <ul className="post-parts">
          {post.parts.map((part) => (
            <li key={part.url} className="post-parts__row">
              <label className="post-parts__label">
                <input type="checkbox" checked={ticked.has(part.url)} onChange={() => toggle(part.url)} />
                <span className="post-parts__heading">{part.heading}</span>
              </label>
              {part.size && <span className="post-parts__size">{part.size}</span>}
            </li>
          ))}
        </ul>

        {error && <p className="modal-error">{error}</p>}

        <div className="modal-actions">
          <button className="btn" disabled={chosen.length === 0 || pending} onClick={() => onDownload(chosen)}>
            {pending
              ? 'Queueing…'
              : `Download ${chosen.length} part${chosen.length === 1 ? '' : 's'}`}
          </button>
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
