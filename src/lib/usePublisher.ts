import { useSearchParams } from 'react-router-dom'

/** "DC Comics" -> "dc". Short enough to read in a url, and stable for both names. */
export function publisherSlug(name: string): string {
  return name.toLowerCase().split(' ')[0]
}

/**
 * Which publisher the Releases page is showing, held in the url.
 *
 * One `pub` for the whole page rather than one per tab: picking DC under one tab and
 * finding yourself back on Marvel under the other is the kind of small re-pick that adds
 * up. Writing through the functional form of setSearchParams is what keeps the outer
 * `tab` intact — building a fresh params object here would drop it and bounce you back
 * to this week's covers every time you changed publisher.
 */
export function usePublisher(names: string[]): {
  current: string | undefined
  select: (name: string) => void
} {
  const [params, setParams] = useSearchParams()
  const wanted = params.get('pub')
  // The first publisher is the fallback, so an unrecognised or absent `pub` can never
  // leave the strip with nothing selected.
  const current = names.find((name) => publisherSlug(name) === wanted) ?? names[0]

  const select = (name: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('pub', publisherSlug(name))
      return next
    }, { replace: true })
  }

  return { current, select }
}
