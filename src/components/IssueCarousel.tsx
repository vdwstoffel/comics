import { useRef } from 'react'
import { Link } from 'react-router-dom'
import TileProgress from './TileProgress'

/** How far a drag has to travel sideways before it counts as a page turn, in pixels. */
const SWIPE_MIN = 40
/**
 * How much more sideways than vertical a drag has to be. Scrolling down the page to the
 * info block starts on the cover, and a thumb never travels in a straight line - without
 * this, reading the credits would turn the page.
 */
const SWIPE_RATIO = 1.5

/** One issue of the run, as the strip needs to draw it. */
export interface CarouselEntry {
  key: string
  /** `#12`, which is both the caption and what the controls are named for. */
  label: string
  /** Absent for an issue you do not have: a cover is a spoiler for a comic unread. */
  coverUrl?: string
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
  /** Where the cover goes. Absent for a gap, which is not a comic you can open. */
  readTo?: string
}

interface IssueCarouselProps {
  entries: CarouselEntry[]
  index: number
  onMove: (index: number) => void
}

/** A cover, or the plate that stands in for one. Shared by the centre and the peeks. */
function Cover({ entry }: { entry: CarouselEntry }) {
  return (
    <div className="issue-carousel__cover">
      {entry.coverUrl
        ? <img src={entry.coverUrl} alt="" />
        : <div className="issue-carousel__plate">{entry.label}</div>}
      <TileProgress readState={entry.readState} percent={entry.percent} />
    </div>
  )
}

/**
 * The run as a strip of covers: one centred and large, its neighbours peeking dimmed at
 * either side so you can see there is more run that way.
 *
 * Controlled - it holds no idea of where you are, because the page does: which issue is
 * centred decides what the info block below and the whole page are about, and two copies
 * of that would drift. The strip's whole job is to offer the four ways of moving (the
 * chevrons, the arrow keys, a swipe) and to say which issue you asked for.
 *
 * A gap is drawn as a plate bearing its number and no art. That is not a placeholder for
 * missing art; it is the rule the rest of the app follows, because a cover is a spoiler
 * for a comic you have not read, and an issue you do not own is one you certainly have not.
 */
export default function IssueCarousel({ entries, index, onMove }: IssueCarouselProps) {
  // Where a drag began, so pointerup can measure it. A ref rather than state: nothing on
  // screen changes between the two events, so re-rendering mid-drag would be waste.
  const from = useRef<{ x: number; y: number } | null>(null)

  const current = entries[index]
  const prev = index > 0 ? entries[index - 1] : null
  const next = index < entries.length - 1 ? entries[index + 1] : null

  if (!current) return null

  const go = (to: number) => {
    if (to >= 0 && to < entries.length) onMove(to)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const start = from.current
    from.current = null
    if (!start) return
    const dx = e.clientX - start.x
    const dy = e.clientY - start.y
    if (Math.abs(dx) < SWIPE_MIN) return
    if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return
    // Dragging the covers leftwards pulls the next issue in, the way a page moves under
    // a thumb - so a leftward drag is forwards.
    go(dx < 0 ? index + 1 : index - 1)
  }

  return (
    <div
      className="issue-carousel"
      data-testid="carousel"
      // Focusable so the arrow keys have somewhere to land, but not a tab stop that
      // competes with the chevrons inside it, which do the same job for a keyboard.
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => { from.current = { x: e.clientX, y: e.clientY } }}
      onPointerUp={onPointerUp}
      onPointerCancel={() => { from.current = null }}
    >
      <button
        type="button"
        className="issue-carousel__arrow issue-carousel__arrow--prev"
        aria-label="Previous issue"
        disabled={index === 0}
        onClick={() => go(index - 1)}
      >
        ◀
      </button>

      {/* The slot is drawn whether or not there is a neighbour to put in it, so that the
          centred cover is centred at both ends of the run as well as in the middle. */}
      <div className="issue-carousel__slot issue-carousel__slot--prev">
        {prev && (
          <div className="issue-carousel__peek"
            data-testid="carousel-prev-peek" aria-hidden="true">
            <Cover entry={prev} />
            <span className="issue-carousel__peek-label">{prev.label}</span>
          </div>
        )}
      </div>

      <div className="issue-carousel__current" data-testid="carousel-current">
        {current.readTo
          ? (
            <Link to={current.readTo} className="issue-carousel__open"
              aria-label={`Read ${current.label}`}>
              <Cover entry={current} />
            </Link>
          )
          : <Cover entry={current} />}
        <span className="issue-carousel__label">{current.label}</span>
      </div>

      <div className="issue-carousel__slot issue-carousel__slot--next">
        {next && (
          <div className="issue-carousel__peek"
            data-testid="carousel-next-peek" aria-hidden="true">
            <Cover entry={next} />
            <span className="issue-carousel__peek-label">{next.label}</span>
          </div>
        )}
      </div>

      <button
        type="button"
        className="issue-carousel__arrow issue-carousel__arrow--next"
        aria-label="Next issue"
        disabled={index === entries.length - 1}
        onClick={() => go(index + 1)}
      >
        ▶
      </button>
    </div>
  )
}
