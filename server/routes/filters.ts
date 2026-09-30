import type { FilterState } from '../models/progress.js'

export interface LibraryQuery {
  publisher?: string
  readState?: string
}

const READ_STATES: FilterState[] = ['unread', 'read']

// An unrecognised value means "no read-state filter", matching how a junk publisher
// simply matches nothing rather than failing the request.
export function readStateOf(value: string | undefined): FilterState | undefined {
  return READ_STATES.includes(value as FilterState) ? (value as FilterState) : undefined
}

export function editionFilterOf(query: LibraryQuery) {
  return { publisher: query.publisher || undefined, readState: readStateOf(query.readState) }
}
