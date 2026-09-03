import { useQuery } from '@tanstack/react-query'
import { api } from '../api'
import type { ApiStoryArcSummary } from '../api'
import CoverTile from '../components/CoverTile'
import LibraryRail from '../components/LibraryRail'

/**
 * The library knows an arc's name and how many of its issues you have; only Comic Vine
 * knows its cover and how long the arc runs. Each tile fetches its own arc under the same
 * query key the arc page uses, so the covers fill in as they arrive and opening one is
 * already a cache hit.
 */
function ArcTile({ arc }: { arc: ApiStoryArcSummary }) {
  const { data } = useQuery({ queryKey: ['arc', arc.name], queryFn: () => api.getArc(arc.name), retry: false })
  const total = data?.arc.issues.length

  return (
    <CoverTile
      to={`/arcs/${encodeURIComponent(arc.name)}`}
      img={data?.arc.imageUrl}
      title={arc.name}
      subtitle={total != null
        ? `${arc.owned} of ${total} issues`
        : `${arc.owned} issue${arc.owned === 1 ? '' : 's'}`}
    />
  )
}

export default function Arcs() {
  const { data, isLoading, error } = useQuery({ queryKey: ['arcs'], queryFn: api.getArcs })
  const arcs = data?.arcs ?? []

  return (
    <>
      <LibraryRail />
      <main className="library-content">
        <h1 className="page-title">Story Arcs</h1>
        {isLoading && <p>Loading…</p>}
        {error && <p>Failed to load story arcs.</p>}
        {data && arcs.length === 0 && (
          <p className="arc-empty">
            No story arcs yet. They arrive with an issue's metadata when you match it to Comic Vine.
          </p>
        )}
        <div className="tile-grid">
          {arcs.map((arc) => <ArcTile key={arc.name} arc={arc} />)}
        </div>
      </main>
    </>
  )
}
