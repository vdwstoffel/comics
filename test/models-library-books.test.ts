import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition } from '../server/models/editions.js'
import { insertBook, updateBook, listLibraryBooks, searchTerms } from '../server/models/books.js'
import { setProgress } from '../server/models/progress.js'
import { replaceBookTags, replaceBookCredits } from '../server/models/metadata.js'

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

// Unread is every book you have not finished, which includes the one you are partway
// through: opening a comic does not take it off the list of comics you have to read.
test('unread is every book nobody has finished', () => {
  const db = openDb(':memory:')
  const { unreadVenom, readingVenom, unreadBatman } = seed(db)

  expect(listLibraryBooks(db, { readState: 'unread' }).map((b) => b.id).sort())
    .toEqual([unreadVenom.id, readingVenom.id, unreadBatman.id].sort())
  db.close()
})

test('a finished book is the one thing unread leaves out', () => {
  const db = openDb(':memory:')
  const { readVenom } = seed(db)

  expect(listLibraryBooks(db, { readState: 'unread' }).map((b) => b.id)).not.toContain(readVenom.id)
  expect(listLibraryBooks(db, { readState: 'read' }).map((b) => b.id)).toEqual([readVenom.id])
  db.close()
})

// The rail carries a publisher and a status at once; a view that honoured only one
// would be telling the user something untrue about what they are looking at.
test('a publisher and a state narrow the list together', () => {
  const db = openDb(':memory:')
  const { unreadVenom, readingVenom } = seed(db)

  expect(listLibraryBooks(db, { readState: 'unread', publisher: 'Marvel' }).map((b) => b.id))
    .toEqual([unreadVenom.id, readingVenom.id])
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

// The shelf no longer separates them out, so the progress bar is the only thing that says
// which of the unread comics you have already started. It has to survive the merge.
test('a book carries the read progress its tile draws', () => {
  const db = openDb(':memory:')
  const { readingVenom } = seed(db)

  const book = listLibraryBooks(db, { readState: 'unread' }).find((b) => b.id === readingVenom.id)!
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

/** The real collected case: two paperback lines, one 2022 run. */
function seedCollected(db: ReturnType<typeof openDb>) {
  const wells = upsertEdition(db, { name: 'Wells and Romita Jr. (2022)', folder: 'w', seriesName: 'Amazing Spider-Man' })
  const zeb = upsertEdition(db, { name: 'By Zeb Wells (2023)', folder: 'z', seriesName: 'Amazing Spider-Man' })
  const collects = {
    collectsVolumeId: 142577, collectsCvName: 'The Amazing Spider-Man', collectsCvStartYear: 2022,
  }
  updateEdition(db, wells.id, { comicvineId: 149382, ...collects })
  updateEdition(db, zeb.id, { comicvineId: 150443, ...collects })
  const mk = (editionId: number, file: string) =>
    insertBook(db, { editionId, filePath: file, pageCount: 20, fileSize: 1 })!
  return { wells: wells.id, zeb: zeb.id, wellsBook: mk(wells.id, 'w/1.cbz'), zebBook: mk(zeb.id, 'z/4.cbz') }
}

test('a collected comic carries its shelf, named for the volume', () => {
  const db = openDb(':memory:')
  const { zeb } = seedCollected(db)
  const book = listLibraryBooks(db, {}).find((b) => b.editionId === zeb)!
  expect(book.shelfKey).toBe('volume:142577')
  expect(book.shelfName).toBe('The Amazing Spider-Man (2022)')
  expect(book.shelfVolumeId).toBe(142577)
  db.close()
})

test('a comic in a stand-alone edition is its own shelf, under its own name', () => {
  const db = openDb(':memory:')
  seed(db)
  const book = listLibraryBooks(db, {}).find((b) => b.editionName === 'Batman (2016)')!
  expect(book.shelfName).toBe('Batman (2016)')
  expect(book.shelfVolumeId).toBeNull()
  db.close()
})

// Spec §5.1: whether a shelf is collapsed is a fact about the library, not about what
// a filter happens to be showing.
test('a filter that hides one collection does not un-collapse the shelf', () => {
  const db = openDb(':memory:')
  const { zeb, wellsBook } = seedCollected(db)
  setProgress(db, wellsBook.id, { lastPage: 20, completed: true })

  const books = listLibraryBooks(db, { readState: 'unread' })
  expect(books.every((b) => b.editionId !== undefined)).toBe(true)
  expect(books.find((b) => b.editionId === zeb)!.shelfVolumeId).toBe(142577)
  db.close()
})

// Searching the library you already own. A comic is findable by what is written on it and
// by the run that holds it, so a run's name brings every issue in with it.

type Fields = Parameters<typeof updateBook>[2]

function addBook(db: ReturnType<typeof openDb>, editionId: number, file: string, fields: Fields = {}) {
  const book = insertBook(db, { editionId, filePath: file, pageCount: 20, fileSize: 1 })!
  updateBook(db, book.id, fields)
  return book
}

/** The ids a search returns, sorted so a test does not depend on shelf order. */
function found(db: ReturnType<typeof openDb>, q: string): number[] {
  return listLibraryBooks(db, { q }).map((b) => b.id).sort((a, b) => a - b)
}

const ids = (...books: Array<{ id: number }>) => books.map((b) => b.id).sort((a, b) => a - b)

test('a run is found by its name, and brings its comics with it', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  const one = addBook(db, uncanny.id, 'u/1.cbz', { number: '1' })
  const two = addBook(db, uncanny.id, 'u/2.cbz', { number: '2' })
  addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })

  // Neither comic says "uncanny" anywhere on itself; the run does.
  expect(found(db, 'uncanny')).toEqual(ids(one, two))
  db.close()
})

test('a comic is found by its own title', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const dofp = addBook(db, uncanny.id, 'u/141.cbz', { number: '141', title: 'Days of Future Past' })
  addBook(db, uncanny.id, 'u/142.cbz', { number: '142' })

  expect(found(db, 'days of future past')).toEqual(ids(dofp))
  db.close()
})

test('matching ignores case', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const one = addBook(db, uncanny.id, 'u/1.cbz', { number: '1' })
  const two = addBook(db, uncanny.id, 'u/2.cbz', { number: '2' })
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })

  expect(found(db, 'UNCANNY')).toEqual(ids(one, two))
  db.close()
})

// "hickman xmen" has to narrow, not widen, and the two words are rarely in one field: one
// is the creator and the other the run.
test('every term must match, though not the same field', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const inferno = addBook(db, uncanny.id, 'u/inferno.cbz', { title: 'Inferno', writer: 'Chris Claremont' })

  expect(found(db, 'uncanny inferno')).toEqual(ids(inferno))
  expect(found(db, 'uncanny claremont')).toEqual(ids(inferno))
  expect(found(db, 'uncanny daredevil')).toEqual([])
  db.close()
})

// Typing 251 means issue 251. A substring match on the number would hand back #1251 as
// well, which is the answer to a different question.
test('an all-digits query matches the issue number exactly', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const issue = addBook(db, uncanny.id, 'u/251.cbz', { number: '251' })
  addBook(db, uncanny.id, 'u/1251.cbz', { number: '1251' })

  expect(found(db, '251')).toEqual(ids(issue))
  expect(found(db, '25')).toEqual([])
  db.close()
})

// The digits rule makes only the issue number exact; every other field still matches as a
// substring, so a run called "2000 AD" is found by "2000" through its name, not lost to it.
test('an all-digits query still finds a run whose name has those digits', () => {
  const db = openDb(':memory:')
  const prog = upsertEdition(db, { name: '2000 AD (1977)', folder: 'p', seriesName: '2000 AD' })
  const issue = addBook(db, prog.id, 'p/5.cbz', { number: '5' })
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })

  expect(found(db, '2000')).toEqual(ids(issue))
  db.close()
})

test('a creator from ComicInfo is found', () => {
  const db = openDb(':memory:')
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  const written = addBook(db, daredevil.id, 'd/1.cbz', { number: '1', writer: 'Kevin Smith' })
  const drawn = addBook(db, daredevil.id, 'd/2.cbz', { number: '2', penciller: 'Joe Quesada' })
  const other = addBook(db, daredevil.id, 'd/3.cbz', { number: '3' })

  // Neither is a Comic Vine credit: these are the columns a scan fills from ComicInfo.xml.
  expect(found(db, 'smith')).toEqual(ids(written))
  expect(found(db, 'quesada')).toEqual(ids(drawn))
  expect(found(db, 'smith')).not.toContain(other.id)
  db.close()
})

// A comic that came through Comic Vine has its credits as rows and nothing in the
// denormalised columns. Finding the creator on one and missing them on the next, for a
// reason nothing on screen could explain, is the failure this guards.
test('a creator from Comic Vine is found', () => {
  const db = openDb(':memory:')
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  const book = addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })
  addBook(db, daredevil.id, 'd/2.cbz', { number: '2' })
  replaceBookCredits(db, book.id, [{ name: 'Jonathan Hickman', role: 'writer' }])

  expect(book.writer).toBeNull()
  expect(found(db, 'hickman')).toEqual(ids(book))
  db.close()
})

test('a credit that is not writer or penciller is found', () => {
  const db = openDb(':memory:')
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  const book = addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })
  addBook(db, daredevil.id, 'd/2.cbz', { number: '2' })
  replaceBookCredits(db, book.id, [{ name: 'Chip Zdarsky', role: 'cover' }])

  expect(found(db, 'zdarsky')).toEqual(ids(book))
  db.close()
})

// The edition's own name for a collection says nothing of what it collects; the volume it
// collects is on collects_cv_name. The series is set apart from it here so only that
// column can be what finds it.
test('a collected edition is found by the volume it collects', () => {
  const db = openDb(':memory:')
  const zeb = upsertEdition(db, { name: 'By Zeb Wells (2023)', folder: 'z', seriesName: 'By Zeb Wells' })
  updateEdition(db, zeb.id, { collectsCvName: 'The Amazing Spider-Man' })
  const daredevil = upsertEdition(db, { name: 'Daredevil (1998)', folder: 'd', seriesName: 'Daredevil' })
  const four = addBook(db, zeb.id, 'z/4.cbz', { number: '4' })
  const five = addBook(db, zeb.id, 'z/5.cbz', { number: '5' })
  addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })

  expect(found(db, 'amazing spider-man')).toEqual(ids(four, five))
  db.close()
})

test('a run is found by its series, or by the name Comic Vine gave its volume', () => {
  const db = openDb(':memory:')
  const wells = upsertEdition(db, { name: 'Wells and Romita Jr. (2022)', folder: 'w', seriesName: 'Amazing Spider-Man' })
  const lethal = upsertEdition(db, { name: 'Lethal (2024)', folder: 'l', seriesName: 'Lethal' })
  updateEdition(db, lethal.id, { cvName: 'Venom: Lethal Protector' })
  const spider = addBook(db, wells.id, 'w/1.cbz', { number: '1' })
  const venom = addBook(db, lethal.id, 'l/1.cbz', { number: '1' })

  expect(found(db, 'amazing')).toEqual(ids(spider))
  expect(found(db, 'protector')).toEqual(ids(venom))
  db.close()
})

// Every existing shelf calls this with no q, and the box clears to an empty string rather
// than disappearing. Neither may turn into "nothing matched".
test('a blank query returns the whole shelf, as if it were absent', () => {
  const db = openDb(':memory:')
  seed(db)
  const whole = listLibraryBooks(db, {})

  expect(whole.length).toBeGreaterThan(0)
  expect(listLibraryBooks(db, { q: '   ' })).toHaveLength(whole.length)
  expect(listLibraryBooks(db, { q: '' })).toHaveLength(whole.length)
  db.close()
})

// The search is one more narrowing beside the rail's, and its parameters are bound after
// the publisher's - a search that quietly ignored either would misdescribe the view.
test('a search narrows alongside the read state and the publisher', () => {
  const db = openDb(':memory:')
  const { unreadVenom, readingVenom } = seed(db)

  expect(listLibraryBooks(db, { q: 'venom', publisher: 'Marvel', readState: 'unread' }).map((b) => b.id).sort())
    .toEqual([unreadVenom.id, readingVenom.id].sort())
  expect(listLibraryBooks(db, { q: 'venom', publisher: 'DC' })).toEqual([])
  expect(listLibraryBooks(db, { q: 'venom', readState: 'read' }).map((b) => b.id)).toHaveLength(1)
  expect(listLibraryBooks(db, { q: 'batman', publisher: 'Marvel' })).toEqual([])
  db.close()
})

// Left unescaped, "%" matches the whole library and "_" any one character, so a search for
// "100%" would be a search for "100" and a lone "%" a search for everything.
test('a wildcard in the query is matched literally, not as a wildcard', () => {
  const db = openDb(':memory:')
  const hundred = upsertEdition(db, { name: '100% Marvel', folder: 'h', seriesName: '100% Marvel' })
  const daredevil = upsertEdition(db, { name: 'Daredevil', folder: 'd', seriesName: 'Daredevil' })
  const marvel = addBook(db, hundred.id, 'h/1.cbz', { number: '1' })
  addBook(db, daredevil.id, 'd/1.cbz', { number: '1' })

  expect(found(db, '%')).toEqual(ids(marvel))
  expect(found(db, '100%')).toEqual(ids(marvel))
  expect(found(db, '_')).toEqual([])
  expect(found(db, '\\')).toEqual([])
  db.close()
})

// SQLite folds case for ASCII letters only. This pins the limit so that nobody "fixes" it
// by accident with something that changes what the rest of the query means.
test('case folding is ASCII only, which is a limit this pins', () => {
  const db = openDb(':memory:')
  const dias = upsertEdition(db, { name: 'Días de Futuro', folder: 'f', seriesName: 'Días de Futuro' })
  const book = addBook(db, dias.id, 'f/1.cbz', { number: '1' })

  expect(found(db, 'Días')).toEqual(ids(book))
  // The D folds; the accented capital does not fold to the lowercase one.
  expect(found(db, 'días')).toEqual(ids(book))
  expect(found(db, 'DÍAS')).toEqual([])
  db.close()
})

test('a search keeps the first eight words and ignores the rest', () => {
  const db = openDb(':memory:')
  expect(searchTerms('  one two  three\tfour five six seven eight nine ten ')).toEqual(
    ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'],
  )
  expect(searchTerms('   ')).toEqual([])
  db.close()
})

test('a query of many words is capped at eight terms', () => {
  const db = openDb(':memory:')
  const uncanny = upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
  const saga = addBook(db, uncanny.id, 'u/135.cbz', { number: '135', title: 'The Dark Phoenix Saga', writer: 'Chris Claremont' })
  const first8 = 'uncanny x-men dark phoenix saga the claremont chris'

  // The ninth word matches nothing, and is never asked.
  expect(found(db, `${first8} zzzz`)).toEqual(ids(saga))
  // The same word as the eighth is asked, which is what shows the cap is what let it by.
  expect(found(db, 'uncanny x-men dark phoenix saga the claremont zzzz chris')).toEqual([])
  db.close()
})

function matchedOf(db: ReturnType<typeof openDb>, q: string, id: number) {
  return listLibraryBooks(db, { q }).find((b) => b.id === id)?.matched
}

function xmen(db: ReturnType<typeof openDb>) {
  return upsertEdition(db, { name: 'Uncanny X-Men (1963)', folder: 'u', seriesName: 'Uncanny X-Men' })
}

test('a comic matched on its own title says so', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1', title: 'Dark Phoenix' })

  expect(matchedOf(db, 'phoenix', book.id)).toBe('name')
  db.close()
})

test('a comic matched on its number says so', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/135.cbz', { number: '135' })
  addBook(db, xmen(db).id, 'u/136.cbz', { number: '136' })

  expect(matchedOf(db, '135', book.id)).toBe('number')
  db.close()
})

// Nothing on the comic itself is in the query; it is here because its edition is.
test('a comic matched through its run says run', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1', title: 'Genesis' })

  expect(matchedOf(db, 'uncanny', book.id)).toBe('run')
  db.close()
})

test('a comic matched on a credit names the person and the role', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1' })
  replaceBookCredits(db, book.id, [{ name: 'Dave Cockrum', role: 'penciller' }, { name: 'Chris Claremont', role: 'writer' }])

  expect(matchedOf(db, 'claremont', book.id)).toEqual({ role: 'writer', name: 'Chris Claremont' })
  db.close()
})

// The search finds a ComicInfo creator on the book's own columns, so the reason has to
// name them too, or the comic would be reported as having come in with its run.
test('a comic matched on a ComicInfo creator names the person and the role', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1', writer: 'Kevin Smith' })

  expect(matchedOf(db, 'smith', book.id)).toEqual({ role: 'writer', name: 'Kevin Smith' })
  db.close()
})

test('a title match wins over a credit match on the same comic', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1', title: 'Claremont Unleashed' })
  replaceBookCredits(db, book.id, [{ name: 'Chris Claremont', role: 'writer' }])

  expect(matchedOf(db, 'claremont', book.id)).toBe('name')
  db.close()
})

// A credit outranks the run because the run is the only reason that draws nothing.
test('a credit match wins over the run it came in with', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1' })
  replaceBookCredits(db, book.id, [{ name: 'Uncanny Person', role: 'writer' }])

  expect(matchedOf(db, 'uncanny', book.id)).toEqual({ role: 'writer', name: 'Uncanny Person' })
  db.close()
})

test('a comic with no title, no number and no credits still reports run', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/bare.cbz')

  expect(matchedOf(db, 'uncanny', book.id)).toBe('run')
  db.close()
})

test('a shelf call carries no reason at all', () => {
  const db = openDb(':memory:')
  const book = addBook(db, xmen(db).id, 'u/1.cbz', { number: '1', title: 'Genesis' })
  replaceBookCredits(db, book.id, [{ name: 'Chris Claremont', role: 'writer' }])

  const shelf = listLibraryBooks(db, {})
  expect(shelf).toHaveLength(1)
  expect(shelf.every((b) => b.matched === undefined && !('matched' in b))).toBe(true)
  expect(listLibraryBooks(db, { q: '   ' }).every((b) => b.matched === undefined)).toBe(true)
  db.close()
})
