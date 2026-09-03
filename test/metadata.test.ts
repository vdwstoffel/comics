import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import {
  replaceBookCredits,
  getBookCredits,
  replaceBookTags,
  getBookTags,
  setCharacterTagIds,
} from '../server/models/metadata.js'

function freshDb() { return openDb(':memory:') }

function makeBook(db: ReturnType<typeof freshDb>) {
  const s = upsertEdition(db, { name: 'Batman', folder: 'Batman' })
  return insertBook(db, { editionId: s.id, filePath: 'Batman/001.cbz', pageCount: 10, fileSize: 100 })!
}

test('replaceBookCredits/getBookCredits round-trip', () => {
  const db = freshDb()
  const book = makeBook(db)
  const credits = [
    { name: 'Scott Snyder', role: 'writer' },
    { name: 'Greg Capullo', role: 'penciler' },
  ]
  replaceBookCredits(db, book.id, credits)
  const result = getBookCredits(db, book.id)
  expect(result).toHaveLength(2)
  expect(result).toContainEqual({ name: 'Scott Snyder', role: 'writer' })
  expect(result).toContainEqual({ name: 'Greg Capullo', role: 'penciler' })
})

test('replaceBookCredits overwrites previous credits', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookCredits(db, book.id, [{ name: 'Old Writer', role: 'writer' }])
  // Replace with new set
  replaceBookCredits(db, book.id, [{ name: 'New Writer', role: 'writer' }, { name: 'New Penciler', role: 'penciler' }])
  const result = getBookCredits(db, book.id)
  expect(result).toHaveLength(2)
  expect(result.find((c) => c.name === 'Old Writer')).toBeUndefined()
  expect(result).toContainEqual({ name: 'New Writer', role: 'writer' })
})

test('replaceBookCredits with empty array clears credits', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookCredits(db, book.id, [{ name: 'Someone', role: 'writer' }])
  replaceBookCredits(db, book.id, [])
  expect(getBookCredits(db, book.id)).toHaveLength(0)
})

test('getBookCredits returns empty array for book with no credits', () => {
  const db = freshDb()
  const book = makeBook(db)
  expect(getBookCredits(db, book.id)).toEqual([])
})

test('replaceBookTags/getBookTags round-trip', () => {
  const db = freshDb()
  const book = makeBook(db)
  const tags = [
    { kind: 'character', value: 'Batman' },
    { kind: 'character', value: 'The Joker' },
    { kind: 'team', value: 'Justice League' },
    { kind: 'story_arc', value: 'Court of Owls' },
  ]
  replaceBookTags(db, book.id, tags)
  const result = getBookTags(db, book.id)
  expect(result).toHaveLength(4)
  expect(result).toContainEqual({ kind: 'character', value: 'Batman' })
  expect(result).toContainEqual({ kind: 'team', value: 'Justice League' })
  expect(result).toContainEqual({ kind: 'story_arc', value: 'Court of Owls' })
})

test('replaceBookTags overwrites previous tags', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [{ kind: 'character', value: 'OldChar' }])
  replaceBookTags(db, book.id, [{ kind: 'character', value: 'NewChar' }])
  const result = getBookTags(db, book.id)
  expect(result).toHaveLength(1)
  expect(result[0].value).toBe('NewChar')
})

test('replaceBookTags with empty array clears tags', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [{ kind: 'character', value: 'Batman' }])
  replaceBookTags(db, book.id, [])
  expect(getBookTags(db, book.id)).toHaveLength(0)
})

// --- character ids ----------------------------------------------------------

test('a character tag carries the Comic Vine id it was matched with', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [
    { kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 },
    { kind: 'team', value: 'Sinister Six' },
  ])
  const tags = getBookTags(db, book.id)
  expect(tags).toContainEqual({ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 })
})

// Tags written before this feature — and any written from ComicInfo.xml during a scan —
// have no id. They must read back without one, not with a null.
test('a tag saved without an id reads back with no extId', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [{ kind: 'character', value: 'Batman' }])
  expect(getBookTags(db, book.id)[0].extId).toBeUndefined()
})

test('setCharacterTagIds fills in ids on existing character tags by name', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [
    { kind: 'character', value: 'Spider-Man' },
    { kind: 'character', value: 'Hobgoblin (Kingsley)' },
    { kind: 'team', value: 'Sinister Six' },
  ])

  setCharacterTagIds(db, book.id, [
    { id: 1443, name: 'Spider-Man' },
    { id: 7605, name: 'Hobgoblin (Kingsley)' },
  ])

  const tags = getBookTags(db, book.id)
  expect(tags).toContainEqual({ kind: 'character', value: 'Spider-Man', extId: 1443 })
  expect(tags).toContainEqual({ kind: 'character', value: 'Hobgoblin (Kingsley)', extId: 7605 })
  // The team tag is untouched — this only fills in characters.
  expect(tags).toContainEqual({ kind: 'team', value: 'Sinister Six' })
})

test('setCharacterTagIds leaves a character it has no id for alone', () => {
  const db = freshDb()
  const book = makeBook(db)
  replaceBookTags(db, book.id, [{ kind: 'character', value: 'Some Guy' }])
  setCharacterTagIds(db, book.id, [{ name: 'Some Guy' }])
  expect(getBookTags(db, book.id)[0].extId).toBeUndefined()
})
