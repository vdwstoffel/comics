import { useRef, useState } from 'react'
import type { ApiArcIssue } from '../api'
import { arcIssueLabel } from '../lib/arcIssueLabel'
import { dropIndex } from '../lib/dragOrder'

interface ArcReorderListProps {
  issues: ApiArcIssue[]
  onSave: (issueIds: number[]) => void
  onCancel: () => void
  saving?: boolean
}

/** The list with `from` lifted out and dropped in at `to`. */
function moved<T>(list: T[], from: number, to: number): T[] {
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}

/**
 * The run as a list you can rearrange.
 *
 * A list rather than the grid the arc normally draws: dragging across a grid needs
 * two-dimensional hit-testing, and one column of equal rows needs none. The list form is
 * also the one where "third, not seventh" is a thing you can see.
 *
 * Up and down are the controls rather than a lesser fallback to dragging - they are the
 * keyboard-reachable path, the same call QueueList makes.
 */
export default function ArcReorderList({ issues, onSave, onCancel, saving }: ArcReorderListProps) {
  const [order, setOrder] = useState(issues)
  const listRef = useRef<HTMLOListElement>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const tops = useRef<number[]>([])
  const rowHeight = useRef(0)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return
    setOrder(moved(order, from, to))
  }

  // Read when the drag starts rather than on every move: the rows do not shift until the
  // drag is committed, so one reading stands for the whole gesture.
  function measure() {
    const rows = [...(listRef.current?.querySelectorAll('li') ?? [])]
    tops.current = rows.map((row) => row.getBoundingClientRect().top)
    rowHeight.current = rows[0]?.getBoundingClientRect().height ?? 1
  }

  return (
    <div className="arc-reorder">
      <p className="arc-reorder__hint">
        Comic Vine records no reading order, so this run is worked out from release dates.
        Put it in the order it reads.
      </p>
      <ol className="arc-reorder__list" ref={listRef}>
        {order.map((issue, index) => {
          const title = arcIssueLabel(issue)
          const state = dragging === issue.id ? ' arc-reorder__row--dragging'
            : dropAt === index && dragging != null ? ' arc-reorder__row--drop' : ''
          return (
            <li key={issue.id} className={`arc-reorder__row${state}`}>
              <button
                type="button"
                className="arc-reorder__handle"
                aria-label={`Drag ${title}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId)
                  measure()
                  setDragging(issue.id)
                  setDropAt(index)
                }}
                onPointerMove={(e) => {
                  if (dragging !== issue.id) return
                  setDropAt(dropIndex(e.clientY, tops.current, rowHeight.current))
                }}
                onPointerUp={(e) => {
                  e.currentTarget.releasePointerCapture(e.pointerId)
                  if (dragging === issue.id && dropAt !== null && dropAt !== index) move(index, dropAt)
                  setDragging(null)
                  setDropAt(null)
                }}
              >⠿</button>
              <span className="arc-reorder__position">{index + 1}</span>
              <span className="arc-reorder__label">{title}</span>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Move ${title} up`}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >↑</button>
              <button
                type="button"
                className="btn btn-ghost"
                aria-label={`Move ${title} down`}
                disabled={index === order.length - 1}
                onClick={() => move(index, index + 1)}
              >↓</button>
            </li>
          )
        })}
      </ol>
      <div className="arc-reorder__actions">
        <button type="button" className="btn" disabled={saving} onClick={() => onSave(order.map((i) => i.id))}>
          {saving ? 'Saving…' : 'Save order'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
