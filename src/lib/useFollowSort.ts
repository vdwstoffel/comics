import { useState } from 'react'
import type { FollowSort } from './followOrder'

const KEY = 'comix.following.sort'

/**
 * How the Following shelf orders Available, remembered in this browser.
 *
 * In localStorage rather than the url, where the publisher choice lives: that one is a
 * view you might link to, this is a standing preference about how you like the shelf, and
 * a url only carries it until the next time you open the page from the header.
 *
 * Every read and write is guarded. A private window or blocked storage throws on access,
 * and losing the remembered choice there is fine where losing the page is not.
 */
export function useFollowSort(): [FollowSort, (sort: FollowSort) => void] {
  const [sort, setSort] = useState<FollowSort>(() => {
    try {
      return localStorage.getItem(KEY) === 'date' ? 'date' : 'name'
    } catch {
      return 'name'
    }
  })

  const choose = (next: FollowSort) => {
    setSort(next)
    try { localStorage.setItem(KEY, next) } catch { /* kept for this visit only */ }
  }

  return [sort, choose]
}
