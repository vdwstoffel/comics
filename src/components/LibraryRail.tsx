import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ReadState } from '../api'
import { STATUS_LABELS } from '../lib/readStatus'
import FilterSidebar from './FilterSidebar'

interface LibraryRailProps {
  activePublisher?: string | null
  activeStatus?: ReadState | null
  /** Omitted on pages that are not the library — the rail navigates home instead. */
  onPublisher?: (key: string | null) => void
  onStatus?: (key: string | null) => void
}

/**
 * The three rails beside the library. Lives outside the library page so the arc views can
 * render it too, which is what keeps the sidebar in place while you browse an arc.
 *
 * Publishers and Status filter in place when the library owns them; from an arc page they
 * navigate home instead. Status survives that trip because it lives in the url — the
 * publisher does not, so it falls back to unfiltered.
 */
export default function LibraryRail({
  activePublisher = null, activeStatus = null, onPublisher, onStatus,
}: LibraryRailProps) {
  const navigate = useNavigate()
  const onArcs = useLocation().pathname.startsWith('/arcs')
  const { data: publishersData } = useQuery({ queryKey: ['publishers'], queryFn: api.getPublishers })
  const { data: allEditionsData } = useQuery({ queryKey: ['editions', null], queryFn: () => api.getEditions() })
  const { data: readStateData } = useQuery({ queryKey: ['read-states'], queryFn: api.getReadStates })
  const { data: arcsData } = useQuery({ queryKey: ['arcs'], queryFn: api.getArcs })

  const publishers = publishersData?.publishers ?? []
  const items: { key: string; label: string; count?: number }[] = publishers.map((p) => ({
    key: p.name, label: p.name, count: p.count,
  }))

  // Editions with no publisher of their own still need a way to be found.
  const unknownCount = (allEditionsData?.editions.length ?? 0) - publishers.reduce((sum, p) => sum + p.count, 0)
  if (unknownCount > 0) items.push({ key: '__unknown__', label: 'Unknown', count: unknownCount })

  const arcs = arcsData?.arcs ?? []

  return (
    <nav className="library-rail">
      <FilterSidebar
        title="Publishers"
        items={items}
        active={activePublisher}
        onSelect={onPublisher ?? (() => navigate('/'))}
      />
      <FilterSidebar
        title="Status"
        // Read is deliberately absent: browsing what you have finished is what the
        // unfiltered shelf is for, while Unread and Reading both answer "what next".
        // The state itself still exists — progress, counts and the per-edition filter
        // all use it; this is one entry in a rail, not a change to what is tracked.
        items={(readStateData?.readStates ?? [])
          .filter((s) => s.name !== 'read')
          .map((s) => ({ key: s.name, label: STATUS_LABELS[s.name], count: s.count }))}
        active={activeStatus}
        onSelect={onStatus ?? ((key) => navigate(key ? `/?status=${key}` : '/'))}
      />
      {/* One door, not a list: arc names are long and there is no ceiling on how many
          a library accumulates, so the rail would truncate and then overflow. */}
      {arcs.length > 0 && (
        <aside className="filter-sidebar" aria-label="Story Arcs">
          <ul className="filter-sidebar__list">
            <li>
              <Link to="/arcs" className={`filter-sidebar__item${onArcs ? ' filter-sidebar__item--active' : ''}`}>
                <span className="filter-sidebar__label">Story Arcs</span>
                <span className="filter-sidebar__count">{arcs.length}</span>
              </Link>
            </li>
          </ul>
        </aside>
      )}
    </nav>
  )
}
