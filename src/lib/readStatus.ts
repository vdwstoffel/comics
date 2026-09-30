import type { FilterState } from '../api'

// Unread and Read are the whole vocabulary a shelf can be filtered by. 'reading' is not
// among them: it describes one book — it is what paints a tile's progress bar — but it is
// not a shelf, because a comic you are partway through is still one you have to read and
// so stays under Unread until it is finished.
const STATES: FilterState[] = ['unread', 'read']

/** The ?status= value, if it names a real filter. */
export function statusFrom(params: URLSearchParams): FilterState | null {
  const value = params.get('status')
  return STATES.includes(value as FilterState) ? (value as FilterState) : null
}

/** Append the active status to an in-app link, so filtering survives navigation. */
export function withStatus(path: string, status: FilterState | null): string {
  return status ? `${path}${path.includes('?') ? '&' : '?'}status=${status}` : path
}

export const STATUS_LABELS: Record<FilterState, string> = {
  unread: 'Unread',
  read: 'Read',
}
