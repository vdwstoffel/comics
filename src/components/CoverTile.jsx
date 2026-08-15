import { Link } from 'react-router-dom'

export default function CoverTile({ to, img, title, subtitle }) {
  return (
    <Link to={to} style={{ width: 160, textDecoration: 'none', color: 'inherit' }}>
      <div style={{ aspectRatio: '2/3', background: '#222', borderRadius: 8, overflow: 'hidden' }}>
        {img && <img src={img} alt={title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
      </div>
      <div style={{ marginTop: 6, fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, opacity: 0.7 }}>{subtitle}</div>}
    </Link>
  )
}
