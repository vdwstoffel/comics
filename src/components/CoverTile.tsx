import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import TileProgress from './TileProgress'

interface CoverTileProps {
  /** Internal route. Give `href` instead for a destination outside the app. */
  to?: string
  href?: string
  img?: string
  title: string
  subtitle?: string
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
  /** Carried to the destination. The shelf uses it to say where closing the comic leads. */
  state?: unknown
  /** Runs as well as following the link, not instead of it. */
  onClick?: () => void
  /**
   * Controls laid over the cover itself - what to do about a comic that is not there.
   *
   * Layered over the tile rather than nested in it, because the tile is a link and a
   * button inside a link would both navigate and act. A gap's cover is a dashed blank
   * with nothing in it, which is the one place on the tile these do not crowd anything.
   */
  overlay?: ReactNode
}

export default function CoverTile({ to, href, img, title, subtitle, readState, percent, state, onClick, overlay }: CoverTileProps) {
  const isRead = readState === 'read'

  const inner = (
    <>
      <div className="cover-tile__image-box" style={isRead ? { filter: 'brightness(0.6)' } : undefined}>
        {img && <img src={img} alt={title} />}
        {isRead && (
          <div className="tile-check" aria-label="Read">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.5 7L5.5 10L11.5 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        )}
        <TileProgress readState={readState} percent={percent} />
      </div>
      <div className="cover-tile__title">{title}</div>
      {subtitle && <div className="cover-tile__subtitle">{subtitle}</div>}
    </>
  )

  // A comic the library does not have lives on Comic Vine, which is not a route.
  const card = href
    ? <a href={href} target="_blank" rel="noreferrer" className="cover-tile">{inner}</a>
    : <Link to={to ?? '#'} state={state} onClick={onClick} className="cover-tile">{inner}</Link>

  if (!overlay) return card
  return (
    <div className="cover-tile__stack">
      {card}
      <div className="cover-tile__overlay">{overlay}</div>
    </div>
  )
}
