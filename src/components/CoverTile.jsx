import { Link } from 'react-router-dom'

export default function CoverTile({ to, img, title, subtitle }) {
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
