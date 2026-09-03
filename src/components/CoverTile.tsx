import { Link } from 'react-router-dom'

interface CoverTileProps {
  /** Internal route. Give `href` instead for a destination outside the app. */
  to?: string
  href?: string
  img?: string
  title: string
  subtitle?: string
  readState?: 'unread' | 'reading' | 'read'
  percent?: number
}

export default function CoverTile({ to, href, img, title, subtitle, readState, percent }: CoverTileProps) {
  const isRead = readState === 'read'
  const isReading = readState === 'reading'

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
        {isReading && (
          <div className="tile-progress" style={{ width: `${percent ?? 0}%` }} aria-label={`In progress: ${percent ?? 0}%`} />
        )}
      </div>
      <div className="cover-tile__title">{title}</div>
      {subtitle && <div className="cover-tile__subtitle">{subtitle}</div>}
    </>
  )

  // A comic the library does not have lives on Comic Vine, which is not a route.
  if (href) {
    return <a href={href} target="_blank" rel="noreferrer" className="cover-tile">{inner}</a>
  }
  return <Link to={to ?? '#'} className="cover-tile">{inner}</Link>
}
