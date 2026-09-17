import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook, listLibraryBooks } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'

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
