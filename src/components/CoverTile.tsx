import { Link } from 'react-router-dom'

interface CoverTileProps {
  to: string
  img?: string
  title: string
  subtitle?: string
}

export default function CoverTile({ to, img, title, subtitle }: CoverTileProps) {
  return (
    <Link to={to} className="cover-tile">
      <div className="cover-tile__image-box">
        {img && <img src={img} alt={title} />}
      </div>
      <div className="cover-tile__title">{title}</div>
      {subtitle && <div className="cover-tile__subtitle">{subtitle}</div>}
    </Link>
  )
}
