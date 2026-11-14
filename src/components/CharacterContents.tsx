import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProfileSection } from '../lib/profileSections'

/**
 * How far below the top of the window a heading counts as the one being read: below the
 * sticky header and the download bar, with a little room.
 */
const READING_LINE = 120

/**
 * The heading you are reading under: the last one whose top has scrolled above the
 * reading line. Measured on scroll rather than watched with an IntersectionObserver,
 * because the answer is "the last heading ABOVE here", which is about headings that are
 * no longer on screen - exactly the ones an observer stops reporting.
 */
function useReading(ids: string[]): string | null {
  const [reading, setReading] = useState<string | null>(null)
  useEffect(() => {
    let frame = 0
    const measure = () => {
      frame = 0
      let current: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top <= READING_LINE) current = id
        else break
      }
      setReading(current)
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [ids])
  return reading
}

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export interface CharacterContentsProps {
  sections: ProfileSection[]
  /** The comics at the foot of the page, listed last so the contents reach them too. */
  comics?: { id: string; count: number }
}

/**
 * The sections of a long profile, to jump between.
 *
 * Beside the article on a wide screen, where it stays in view as you read; above it on a
 * phone, folded, since there is no side to put it on. The section you are reading is
 * marked and opened onto its subsections, so the story arcs under "Major Story Arcs" are
 * there when you are in them and out of the way when you are not.
 *
 * Buttons rather than links: jumping down the page is not going anywhere, and an anchor
 * would write the heading into the url.
 */
export default function CharacterContents({ sections, comics }: CharacterContentsProps) {
  // Keyed on the ids themselves, so the scroll listener is replaced when the page moves to
  // another character - the component stays mounted across that - and not on every render.
  const key = sections.map((s) => [s.id, ...s.children.map((c) => c.id)].join(',')).join(';')
  const ids = useMemo(() => sections.flatMap((s) => [s.id, ...s.children.map((c) => c.id)]), [key])
  const reading = useReading(ids)
  const [open, setOpen] = useState(false)
  const current = sections.find((s) => s.id === reading || s.children.some((c) => c.id === reading))
  const body = useRef<HTMLDivElement>(null)

  // Iron Man's "Major Story Arcs" alone lists sixty subsections, more than the sidebar has
  // room for, so the one being read is kept in view inside it. Scrolled by hand rather
  // than with scrollIntoView, which would scroll the page as well. The body is the items'
  // positioned parent (see the stylesheet), so an item's offsetTop is its place inside it.
  useEffect(() => {
    const box = body.current
    const item = box?.querySelector<HTMLElement>('[aria-current="location"]')
    if (!box || !item) return
    const top = item.offsetTop
    if (top < box.scrollTop) box.scrollTop = top - 8
    else if (top + item.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTop = top + item.offsetHeight - box.clientHeight + 8
    }
  }, [reading])

  function go(id: string) {
    jumpTo(id)
    setOpen(false)
  }

  return (
    <nav className="character-contents" aria-label="Contents">
      <button
        type="button"
        className="character-contents__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Contents {open ? '▴' : '▾'}
      </button>
      <div ref={body} className={`character-contents__body${open ? ' character-contents__body--open' : ''}`}>
        <p className="character-contents__title">Contents</p>
        <ol className="character-contents__list">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={`character-contents__item${s === current ? ' character-contents__item--current' : ''}`}
                aria-current={s.id === reading ? 'location' : undefined}
                onClick={() => go(s.id)}
              >
                {s.text}
              </button>
              {s === current && s.children.length > 0 && (
                <ol className="character-contents__sublist">
                  {s.children.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={`character-contents__subitem${c.id === reading ? ' character-contents__subitem--current' : ''}`}
                        aria-current={c.id === reading ? 'location' : undefined}
                        onClick={() => go(c.id)}
                      >
                        {c.text}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
          {comics && comics.count > 0 && (
            <li>
              <button type="button" className="character-contents__item character-contents__item--comics" onClick={() => go(comics.id)}>
                Your comics ({comics.count})
              </button>
            </li>
          )}
        </ol>
      </div>
    </nav>
  )
}
