import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook, updateBook } from '../server/models/books.js'
import { replaceBookTags, getBookTags } from '../server/models/metadata.js'
import { resolveArcId } from '../server/services/arcIdentity.js'
import type { ComicVineClient } from '../server/lib/comicvine.js'

function seed() {
  const db = openDb(':memory:')
  const edition = upsertEdition(db, { name: 'Daredevil', folder: 'Daredevil' })
  const book = insertBook(db, { editionId: edition.id, filePath: 'Daredevil/1.cbz', pageCount: 1, fileSize: 1 })!
  updateBook(db, book.id, { comicvineId: 201 })
  return { db, book }
}

const cvReturning = (storyArcs: Array<{ id: number; name: string }>) =>
  ({ getIssue: async () => ({ storyArcs }) } as unknown as ComicVineClient)

test('a stored tag id is used without asking Comic Vine', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral', extId: 56676 }])
  const cv = { getIssue: async () => { throw new Error('should not be asked') } } as unknown as ComicVineClient
  expect(await resolveArcId(t.db, cv, 'Death Spiral')).toEqual({ id: 56676 })
})

test('a tag with no id is backfilled from the issue that carries it', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  expect(await resolveArcId(t.db, cvReturning([{ id: 56676, name: 'Death Spiral' }]), 'Death Spiral'))
    .toEqual({ id: 56676 })
  // Backfilled, so the next resolve costs nothing.
  expect(getBookTags(t.db, t.book.id)[0].extId).toBe(56676)
})

test('an arc the library does not hold is a 404', async () => {
  const t = seed()
  expect(await resolveArcId(t.db, cvReturning([]), 'Nothing')).toEqual({
    code: 404, error: 'arc not in this library',
  })
})

test('an arc Comic Vine cannot name is a 404', async () => {
  const t = seed()
  replaceBookTags(t.db, t.book.id, [{ kind: 'story_arc', value: 'Death Spiral' }])
  expect(await resolveArcId(t.db, cvReturning([{ id: 1, name: 'Something Else' }]), 'Death Spiral'))
    .toEqual({ code: 404, error: 'arc not found on Comic Vine' })
})
