interface FilterItem {
  key: string
  label: string
}

interface FilterSidebarProps {
  title: string
  items: FilterItem[]
  active: string | null
  onSelect: (key: string | null) => void
}

export default function FilterSidebar({ title, items, active, onSelect }: FilterSidebarProps) {
  return (
    <aside className="filter-sidebar">
      <div className="filter-sidebar__title">{title}</div>
      <ul className="filter-sidebar__list">
        <li>
          <button
            className={`filter-sidebar__item${active === null ? ' filter-sidebar__item--active' : ''}`}
            onClick={() => onSelect(null)}
          >
            All
          </button>
        </li>
        {items.map((item) => (
          <li key={item.key}>
            <button
              className={`filter-sidebar__item${active === item.key ? ' filter-sidebar__item--active' : ''}`}
              onClick={() => onSelect(item.key)}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
