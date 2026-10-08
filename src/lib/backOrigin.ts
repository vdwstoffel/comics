import { useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * Where a link was clicked, carried in its navigation state so the page it opens can
 * offer a way back that names the place you actually came from.
 *
 * A run is reachable from the library, from a series, from the follows shelf and from an
 * issue's details, and an arc from three of those. A fixed "← Library" is right on one of
 * those routes and a lie on the rest: it put you on the home shelf having told you it
 * would, which is a worse answer than not offering the link at all.
 */
export interface BackOrigin {
  /** Path and query of the page the link was clicked on. */
  href: string
  /** What to call that page: "Library", "Following", a series' or an arc's own name. */
  label: string
}

/**
 * A human name for a page, read off its route.
 *
 * Off the route rather than passed down from the page, because the page that owns the
 * link is not always the one that knows its own title - the shelf tiles are drawn by two
 * different pages and have no idea which one they are on. The one name no route carries
 * is a run's, which is why `useBackOrigin` takes an override.
 */
export function labelForPath(pathname: string): string {
  if (pathname === '/following') return 'Following'
  if (pathname === '/arcs') return 'All story arcs'
  const arc = /^\/arcs\/(.+)$/.exec(pathname)
  if (arc) return decodeURIComponent(arc[1])
  // Before the series pattern: an annuals url is a series url with a tail, so the looser
  // rule would match it first and name the page after the run it hangs off.
  const annuals = /^\/series\/(.+)\/annuals$/.exec(pathname)
  if (annuals) return `${decodeURIComponent(annuals[1])} annuals`
  const series = /^\/series\/(.+)$/.exec(pathname)
  if (series) return decodeURIComponent(series[1])
  return 'Library'
}

/**
 * The navigation state a link should carry, describing the page it is being clicked on.
 *
 * `label` names this page when the route cannot - a run's own name lives in its data, not
 * its url.
 */
export function useBackOrigin(label?: string): { from: BackOrigin } {
  const { pathname, search } = useLocation()
  return { from: { href: `${pathname}${search}`, label: label ?? labelForPath(pathname) } }
}

/**
 * The other end: what a page's back link should say and do.
 *
 * The origin is captured when the path changes rather than read every render, because a
 * page that writes to its own query string - the run does, every time the carousel moves
 * or the covers open - replaces its history entry, and a replacement carries no state.
 * Read live, the way back would vanish the moment you touched anything on the page.
 *
 * `onClick` steps back through history instead of following the href, so the page you
 * return to is restored rather than rebuilt: its scroll position, the series panel you
 * had open, every choice it holds outside the url. The href stays a real one so that
 * middle-click still opens it, and so a page reached cold - a bookmark, a pasted url -
 * has somewhere to go when there is no history to step back through.
 */
export function useBackLink(fallbackHref: string, fallbackLabel: string) {
  const location = useLocation()
  const navigate = useNavigate()
  const arrived = useRef<{ pathname: string; from?: BackOrigin }>({ pathname: '' })
  if (arrived.current.pathname !== location.pathname) {
    arrived.current = {
      pathname: location.pathname,
      from: (location.state as { from?: BackOrigin } | null)?.from,
    }
  }
  const from = arrived.current.from

  return {
    to: from?.href ?? fallbackHref,
    label: from?.label ?? fallbackLabel,
    onClick: (e: { preventDefault: () => void }) => {
      // React Router names the first entry of a history stack 'default', so anything else
      // means there is a page behind this one to step back onto.
      if (!from || location.key === 'default') return
      e.preventDefault()
      navigate(-1)
    },
  }
}
