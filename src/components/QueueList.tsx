import { useRef, useState } from 'react'
import { dropIndex } from '../lib/dragOrder'
import type { QueueEntry } from '../api'

interface QueueListProps {
  entries: QueueEntry[]
  onMove: (id: number, index: number) => void
  onCancel: (id: number) => void
}

/**
 * What is waiting, and the two ways to reorder it.
 *
 * Drag is wired with Pointer Events rather than HTML5 drag-and-drop, which does not fire
 * on a tablet at all. The up and down buttons are not a lesser fallback: they are the
 * keyboard-reachable path, and they keep working if a device's pointer behaviour is odd.
 */
export default function QueueList({ entries, onMove, onCancel }: QueueListProps) {
  const listRef = useRef<HTMLUListElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const tops = useRef<number[]>([])
  const rowHeight = useRef(0)

  if (entries.length === 0) return <p className="queue-list__empty">Nothing waiting.</p>

  function measure() {
    const rows = [...(listRef.current?.querySelectorAll('li') ?? [])]
    tops.current = rows.map((row) => row.getBoundingClientRect().top)
    rowHeight.current = rows[0]?.getBoundingClientRect().height ?? 1
  }

  return (
    <ul className="queue-list" ref={listRef}>
      {entries.map((entry, index) => {
        const running = entry.state === 'running'
        return (
          <li
            key={entry.id}
            className={`queue-list__row${dragging === entry.id ? ' queue-list__row--dragging' : ''}${dropAt === index && dragging != null ? ' queue-list__row--drop' : ''}`}
          >
            <button
              type="button"
              className="queue-list__handle"
              aria-label={`Drag ${entry.label ?? entry.url}`}
              disabled={running}
              onPointerDown={(e) => {
                if (running) return
                e.currentTarget.setPointerCapture(e.pointerId)
                measure()
                setDragging(entry.id)
                setDropAt(index)
              }}
              onPointerMove={(e) => {
                if (dragging !== entry.id) return
                setDropAt(dropIndex(e.clientY, tops.current, rowHeight.current))
              }}
              onPointerUp={(e) => {
                e.currentTarget.releasePointerCapture(e.pointerId)
                if (dragging === entry.id && dropAt !== null && dropAt !== index) onMove(entry.id, dropAt)
                setDragging(null)
                setDropAt(null)
              }}
            >
              ⠿
            </button>

            <span className="queue-list__label">{entry.label ?? entry.url}</span>
            {running && <span className="queue-list__state">downloading</span>}

            <button
              type="button" className="btn btn-ghost" aria-label={`Move up ${entry.label ?? entry.url}`}
              disabled={running || index === 0}
              onClick={() => onMove(entry.id, index - 1)}
            >↑</button>
            <button
              type="button" className="btn btn-ghost" aria-label={`Move down ${entry.label ?? entry.url}`}
              disabled={running || index === entries.length - 1}
              onClick={() => onMove(entry.id, index + 1)}
            >↓</button>
            <button
              type="button" className="btn btn-ghost" aria-label={`Cancel ${entry.label ?? entry.url}`}
              onClick={() => onCancel(entry.id)}
            >Cancel</button>
          </li>
        )
      })}
    </ul>
  )
}
