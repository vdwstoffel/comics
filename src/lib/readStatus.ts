import type { ReadState } from '../api'

const STATES: ReadState[] = ['unread', 'reading', 'read']

/** The ?status= value, if it names a real read state. */
export function statusFrom(params: URLSearchParams): ReadState | null {
  const value = params.get('status')
  return STATES.includes(value as ReadState) ? (value as ReadState) : null
}

/** Append the active status to an in-app link, so filtering survives navigation. */
export function withStatus(path: string, status: ReadState | null): string {
  return status ? `${path}${path.includes('?') ? '&' : '?'}status=${status}` : path
}

export const STATUS_LABELS: Record<ReadState, string> = {
  unread: 'Unread',
  reading: 'Reading',
  read: 'Read',
}
