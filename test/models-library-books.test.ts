import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook, listLibraryBooks } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { replaceBookTags } from '../server/models/metadata.js'

function seed(db: ReturnType<typeof openDb>) {
  const venom = upsertEdition(db, { name: 'Venom (2025)', folder: 'Venom/Venom (2025)', seriesName: 'Venom' })
  updateEdition(db, venom.id, { publisher: 'Marvel' })
  const batman = upsertEdition(db, { name: 'Batman (2016)', folder: 'Batman/Batman (2016)', seriesName: 'Batman' })
  updateEdition(db, batman.id, { publisher: 'DC' })

  const mk = (editionId: number, file: string, number: string) => {
    const b = insertBook(db, { editionId, filePath: file, pageCount: 20, fileSize: 1 })!
    updateBook(db, b.id, { number })
    return b
  }
  const books = {
    unreadVenom: mk(venom.id, 'Venom/Venom (2025)/venom_255.cbz', '255'),
    readingVenom: mk(venom.id, 'Venom/Venom (2025)/venom_256.cbz', '256'),
    readVenom: mk(venom.id, 'Venom/Venom (2025)/venom_257.cbz', '257'),
    unreadBatman: mk(batman.id, 'Batman/Batman (2016)/batman_001.cbz', '1'),
  }
  // Set here, so the names above are true in every test rather than in the two that
  // remembered to do it themselves.
  setProgress(db, books.readingVenom.id, { lastPage: 5 })
  setProgress(db, books.readVenom.id, { lastPage: 20, completed: true })
  return books
}

test('unread is every book nobody has opened', () => {
  const db = openDb(':memory:')
  const { unreadVenom, unreadBatman } = seed(db)

  expect(listLibraryBooks(db, { readState: 'unread' }).map((b) => b.id).sort())
    .toEqual([unreadVenom.id, unreadBatman.id].sort())
  db.close()
})

test('reading is every book somebody is partway through', () => {
  const db = openDb(':memory:')
  const { readingVenom } = seed(db)

  expect(listLibraryBooks(db, { readState: 'reading' }).map((b) => b.id)).toEqual([readingVenom.id])
  db.close()
})

// The rail carries a publisher and a status at once; a view that honoured only one
// would be telling the user something untrue about what they are looking at.
test('a publisher and a state narrow the list together', () => {
  const db = openDb(':memory:')
  const { unreadVenom } = seed(db)

  expect(listLibraryBooks(db, { readState: 'unread', publisher: 'Marvel' }).map((b) => b.id))
    .toEqual([unreadVenom.id])
  db.close()
})

test('books come back in series then issue order', () => {
  const db = openDb(':memory:')
  seed(db)

  // Batman before Venom by series; within a series, by issue number.
  expect(listLibraryBooks(db, {}).map((b) => b.number))
    .toEqual(['1', '255', '256', '257'])
  db.close()
})

test('a book carries the read progress its tile draws', () => {
  const db = openDb(':memory:')
  seed(db)

  const [book] = listLibraryBooks(db, { readState: 'reading' })
  expect(book.readState).toBe('reading')
  expect(book.percent).toBeGreaterThan(0)
  db.close()
})

test('no state at all lists the whole library', () => {
  const db = openDb(':memory:')
  seed(db)
  expect(listLibraryBooks(db, {})).toHaveLength(4)
  db.close()
})

// The unread shelf groups its comics by the volume they belong to, and a group needs
// something to call itself. The name lives on the edition, which this query already
// joins - without carrying it out, the page would need a second request per volume.
test('each book carries the name of the volume it belongs to', () => {
  const db = openDb(':memory:')
  seed(db)

  const byNumber = Object.fromEntries(
    listLibraryBooks(db, { readState: 'unread' }).map((b) => [b.number, b.editionName]),
  )

  expect(byNumber['255']).toBe('Venom (2025)')
  expect(byNumber['1']).toBe('Batman (2016)')
  db.close()
})

// One entry per series on the shelf means the grid has to know which series a comic is in,
// and the series lives on the edition - the same join that already supplies the volume's
// name. Three volumes of Batman are one tile only if all three books say "Batman".
test('each book carries the series its volume belongs to', () => {
  const db = openDb(':memory:')
  seed(db)

  const byNumber = Object.fromEntries(
    listLibraryBooks(db, { readState: 'unread' }).map((b) => [b.number, b.seriesName]),
  )

  expect(byNumber['255']).toBe('Venom')
  expect(byNumber['1']).toBe('Batman')
  db.close()
})

// An edition nobody has given a series to still has to land somewhere, and the shelf
// falls back to the volume's own name. Reporting null rather than guessing here keeps
// that fallback in one place.
test('an edition with no series of its own reports none', () => {
  const db = openDb(':memory:')
  const loose = upsertEdition(db, { name: 'One-Shot (2026)', folder: 'One-Shot' })
  updateEdition(db, loose.id, { seriesName: null })
  insertBook(db, { editionId: loose.id, filePath: 'One-Shot/one_shot.cbz', pageCount: 20, fileSize: 1 })

  const [book] = listLibraryBooks(db, { readState: 'unread' })
  expect(book.seriesName).toBeNull()
  db.close()
})

// Grouping the shelf by story arc is a question about tags the library already holds, so
// it is answered here rather than by a request per tile - and never by Comic Vine.
test('a book carries the story arcs it is tagged with', () => {
  const db = openDb(':memory:')
  const { unreadVenom } = seed(db)
  replaceBookTags(db, unreadVenom.id, [
    { kind: 'character', value: 'Venom' },
    { kind: 'story_arc', value: 'Armageddon' },
  ])

  const book = listLibraryBooks(db, { readState: 'unread' }).find((b) => b.id === unreadVenom.id)!
  expect(book.arcs).toEqual(['Armageddon'])
  db.close()
})

test('a book in two arcs carries both', () => {
  const db = openDb(':memory:')
  const { unreadVenom } = seed(db)
  replaceBookTags(db, unreadVenom.id, [
    { kind: 'story_arc', value: 'Armageddon' },
    { kind: 'story_arc', value: 'King in Black' },
  ])

  const book = listLibraryBooks(db, { readState: 'unread' }).find((b) => b.id === unreadVenom.id)!
  expect(book.arcs).toEqual(['Armageddon', 'King in Black'])
  db.close()
})

// Most comics carry no arc at all. An empty list rather than a missing field keeps the
// shelf from having to ask whether the server knew about arcs or the comic had none.
test('a book in no arc carries an empty list', () => {
  const db = openDb(':memory:')
  const { unreadBatman } = seed(db)

  const book = listLibraryBooks(db, { readState: 'unread' }).find((b) => b.id === unreadBatman.id)!
  expect(book.arcs).toEqual([])
  db.close()
})
