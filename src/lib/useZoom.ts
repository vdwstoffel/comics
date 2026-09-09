import { useCallback, useEffect, useRef, useState } from 'react'
import { FIT, clampOffset, zoomAbout } from './zoom'
import type { Point, ZoomState } from './zoom'

/** A notch of the wheel. Small enough that a zoom feels continuous rather than stepped. */
const WHEEL_STEP = 1.0015

interface Pointers {
  /** Live pointers on the viewport, by id, so a pinch can be told from a drag. */
  active: Map<number, Point>
  /** Distance between two fingers at the last move, for the pinch factor. */
  spread: number | null
  /** Where a one-finger drag was last seen. */
  last: Point | null
}

/**
 * Pinch, wheel and drag over a page.
 *
 * All the arithmetic lives in ./zoom, which is pure and tested on its own; this only
 * turns events into calls on it. Pointer Events are used rather than touch events so a
 * finger and a mouse take the same path — a drag is one pointer, a pinch is two, and
 * neither needs to know which kind it is.
 */
export function useZoom() {
  const [state, setState] = useState<ZoomState>(FIT)
  // A callback ref, not useRef: the viewport does not exist while the book is loading, and
  // an effect keyed on a ref object would have bound its wheel listener to nothing and
  // never run again once the element appeared.
  const [node, setNode] = useState<HTMLElement | null>(null)
  const pointers = useRef<Pointers>({ active: new Map(), spread: null, last: null })

  const viewport = useCallback(() => {
    const box = node?.getBoundingClientRect()
    return { width: box?.width || 0, height: box?.height || 0 }
  }, [node])

  const reset = useCallback(() => setState(FIT), [])

  // Wheel has to be bound by hand: React's onWheel is passive, so preventDefault there is
  // ignored and the browser scrolls the page out from under the zoom.
  useEffect(() => {
    if (!node) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const box = node.getBoundingClientRect()
      const point = { x: e.clientX - box.left, y: e.clientY - box.top }
      setState((s) => zoomAbout(s, WHEEL_STEP ** -e.deltaY, point, { width: box.width, height: box.height }))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [node])

  const relative = useCallback((e: { clientX: number; clientY: number }): Point => {
    const box = node?.getBoundingClientRect()
    return { x: e.clientX - (box?.left ?? 0), y: e.clientY - (box?.top ?? 0) }
  }, [node])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const p = pointers.current
    p.active.set(e.pointerId, relative(e))
    p.last = p.active.size === 1 ? relative(e) : null
    p.spread = null
  }, [relative])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const p = pointers.current
    if (!p.active.has(e.pointerId)) return
    p.active.set(e.pointerId, relative(e))
    const points = [...p.active.values()]

    if (points.length >= 2) {
      // Pinch: zoom about the midpoint by however much the fingers spread.
      const [a, b] = points
      const spread = Math.hypot(a.x - b.x, a.y - b.y)
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
      if (p.spread && spread > 0) {
        const factor = spread / p.spread
        setState((s) => zoomAbout(s, factor, midpoint, viewport()))
      }
      p.spread = spread
      p.last = null
      return
    }

    // Drag: pan, but only when there is something to pan. At fit the page fills the
    // frame and a drag is just a stray finger.
    const now = points[0]
    if (p.last) {
      const dx = now.x - p.last.x
      const dy = now.y - p.last.y
      setState((s) => (s.scale <= 1 ? s : { ...s, ...clampOffset(s.scale, { x: s.x + dx, y: s.y + dy }, viewport()) }))
    }
    p.last = now
  }, [relative, viewport])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    const p = pointers.current
    p.active.delete(e.pointerId)
    p.spread = null
    // Lifting one finger of a pinch leaves the other mid-gesture; pick it up as the drag.
    p.last = p.active.size === 1 ? [...p.active.values()][0] : null
  }, [])

  return {
    state,
    /** Put on the element being zoomed, in place of a ref. */
    ref: setNode,
    zoomed: state.scale > 1,
    reset,
    /** Spread onto the element being zoomed. */
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onDoubleClick: reset,
    },
    /** The transform to put on the page, or undefined while it is simply fitted. */
    transform: state.scale === 1 && state.x === 0 && state.y === 0
      ? undefined
      : `translate(${state.x}px, ${state.y}px) scale(${state.scale})`,
  }
}
