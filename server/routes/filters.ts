import type { ReadState } from '../models/progress.js'

export interface LibraryQuery {
  publisher?: string
  readState?: string
}

const READ_STATES: ReadState[] = ['unread', 'reading', 'read']

// An unrecognised value means "no read-state filter", matching how a junk publisher
// simply matches nothing rather than failing the request.
export function readStateOf(value: string | undefined): ReadState | undefined {
  return READ_STATES.includes(value as ReadState) ? (value as ReadState) : undefined
}

export function editionFilterOf(query: LibraryQuery) {
  return { publisher: query.publisher || undefined, readState: readStateOf(query.readState) }
}
