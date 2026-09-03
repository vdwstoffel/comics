import { Link } from 'react-router-dom'

interface FilterItem {
  key: string
  label: string
  count?: number
  /** Set to navigate instead of filtering in place. */
  href?: string
}

interface FilterSidebarProps {
  title: string
  items: FilterItem[]
  active: string | null
  onSelect?: (key: string | null) => void
  /** Set to make the "All" entry navigate instead of clearing a filter. */
  allHref?: string
}

/**
 * A titled rail of choices. Publishers and Status filter the grid in place; Story Arcs
 * navigates instead, so an entry renders as a link when it is given an href.
 */
export default function FilterSidebar({ title, items, active, onSelect, allHref }: FilterSidebarProps) {
  const className = (key: string | null) =>
    `filter-sidebar__item${active === key ? ' filter-sidebar__item--active' : ''}`

  const body = (item: FilterItem) => (
    <>
      <span className="filter-sidebar__label">{item.label}</span>
      {item.count != null && <span className="filter-sidebar__count">{item.count}</span>}
    </>
  )

  return (
    <aside className="filter-sidebar" aria-label={title}>
      <div className="filter-sidebar__title">{title}</div>
      <ul className="filter-sidebar__list">
        <li>
          {allHref ? (
            <Link to={allHref} className={className(null)}>
              <span className="filter-sidebar__label">All</span>
            </Link>
          ) : (
            <button className={className(null)} onClick={() => onSelect?.(null)}>
              <span className="filter-sidebar__label">All</span>
            </button>
          )}
        </li>
        {items.map((item) => (
          <li key={item.key}>
            {item.href ? (
              <Link to={item.href} className={className(item.key)}>{body(item)}</Link>
            ) : (
              <button className={className(item.key)} onClick={() => onSelect?.(item.key)}>{body(item)}</button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  )
}
