import type { QueryClient } from '@tanstack/react-query'

/**
 * Everything that draws whether a comic is read: the run and its annuals, the comic's own
 * detail, the shelves and their read filters, and the follows shelf that counts what is
 * left. Marking a comic read from a page has to reach all of them - the reader does not,
 * because every one of these is read again when you come back from it.
 */
const READ_STATE_KEYS = [
  'edition', 'edition-issues', 'book', 'editions', 'series', 'volume',
  'library-books', 'read-states', 'follows', 'arc',
]

export function invalidateReadState(qc: QueryClient): void {
  for (const key of READ_STATE_KEYS) void qc.invalidateQueries({ queryKey: [key] })
}
