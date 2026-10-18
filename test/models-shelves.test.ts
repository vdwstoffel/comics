import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, listEditions } from '../server/models/editions.js'
import type { EditionUpdate } from '../server/models/editions.js'
import { insertBook } from '../server/models/books.js'
import { groupIntoShelves } from '../server/models/shelves.js'
import type { Db } from '../server/types.js'

function seed(db: Db, name: string, books: number, fields: EditionUpdate = {}) {
  const edition = upsertEdition(db, { name, folder: name })
  updateEdition(db, edition.id, fields)
  for (let i = 0; i < books; i++) {
    insertBook(db, { editionId: edition.id, filePath: `${name}/${i}.cbz`, pageCount: 10, fileSize: 100 })
  }
  return edition
}

/** The real Amazing Spider-Man shelf, plus the two cases the live library cannot make. */
function seedLibrary(db: Db) {
  const collects2022 = {
    collectsVolumeId: 142577,
    collectsCvName: 'The Amazing Spider-Man',
    collectsCvStartYear: 2022,
    collectsCvSiteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/',
  }
  seed(db, 'The Amazing Spider-Man by Wells and Romita Jr. (2022)', 3, { comicvineId: 149382, ...collects2022 })
  seed(db, 'Amazing Spider-Man By Zeb Wells (2023)', 9, { comicvineId: 150443, ...collects2022 })
  seed(db, 'Amazing Spider-Man: The 8 Deaths Of Spider-Man (2025)', 1, { comicvineId: 165956, ...collects2022 })

  // Review Focus 1: a collects link nobody else shares.
  seed(db, 'Some Lone Collection (2024)', 2, {
    comicvineId: 888, collectsVolumeId: 999, collectsCvName: 'Something Else', collectsCvStartYear: 1999,
  })

  // Spec §2.3: a run owned as issues, and a trade reprinting it.
  seed(db, 'The Amazing Spider-Man (2025)', 37, {
    comicvineId: 163325,
    cvName: 'The Amazing Spider-Man',
    cvStartYear: 2025,
    cvSiteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-163325/',
  })
  seed(db, 'Amazing Spider-Man By Joe Kelly (2026)', 1, {
    comicvineId: 170000, collectsVolumeId: 163325, collectsCvName: 'The Amazing Spider-Man', collectsCvStartYear: 2025,
  })
  return db
}

test('three collections of one volume become one shelf named for the volume', () => {
  const db = seedLibrary(openDb(':memory:'))
  const shelves = groupIntoShelves(listEditions(db))
  const asm = shelves.find((s) => s.key === 'volume:142577')!
  expect(asm.name).toBe('The Amazing Spider-Man (2022)')
  expect(asm.editions).toHaveLength(3)
  expect(asm.bookCount).toBe(13)
  expect(asm.volumeId).toBe(142577)
  expect(asm.holdsIssues).toBe(false)
  expect(asm.siteUrl).toBe('https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/')
  db.close()
})

// Review Focus 1: a tile that opens onto one tile is a click that buys nothing. The
// shelf is still named for the run it collects - not collapsing is about the click,
// not about pretending the edition is something other than a collection.
test('a lone collection is not collapsed', () => {
  const db = seedLibrary(openDb(':memory:'))
  const shelf = groupIntoShelves(listEditions(db)).find((s) => s.key === 'volume:999')!
  expect(shelf.editions).toHaveLength(1)
  expect(shelf.volumeId).toBeNull()
  expect(shelf.name).toBe('Something Else (1999)')
  db.close()
})

test('a shelf holding the volume issues takes its name and says so', () => {
  const db = seedLibrary(openDb(':memory:'))
  const shelf = groupIntoShelves(listEditions(db)).find((s) => s.key === 'volume:163325')!
  expect(shelf.name).toBe('The Amazing Spider-Man (2025)')
  expect(shelf.holdsIssues).toBe(true)
  expect(shelf.editions).toHaveLength(2)
  expect(shelf.bookCount).toBe(38)
  db.close()
})

test('every edition lands on exactly one shelf', () => {
  const db = seedLibrary(openDb(':memory:'))
  const editions = listEditions(db)
  const shelves = groupIntoShelves(editions)
  expect(shelves.flatMap((s) => s.editions.map((e) => e.id)).sort()).toEqual(editions.map((e) => e.id).sort())
  db.close()
})

// A lone collection is still a run of that volume, and saying so is the whole point of
// having asked. The shelf is not collapsed - one edition is one click - but it is named
// for what it is rather than for the paperback it arrived as.
test('a lone confirmed collection is named for the volume it collects', () => {
  const db = openDb(':memory:')
  seed(db, 'Captain America by Rick Remender Omnibus (2021)', 1, {
    comicvineId: 138889,
    cvName: 'Captain America by Rick Remender Omnibus',
    cvStartYear: 2021,
    collectsVolumeId: 54110,
    collectsCvName: 'Captain America',
    collectsCvStartYear: 2013,
    collectsCvSiteUrl: 'https://comicvine.gamespot.com/captain-america/4050-54110/',
  })
  const [shelf] = groupIntoShelves(listEditions(db))
  expect(shelf.name).toBe('Captain America (2013)')
  expect(shelf.startYear).toBe(2013)
  expect(shelf.siteUrl).toBe('https://comicvine.gamespot.com/captain-america/4050-54110/')
  // Still one edition, so still its own page rather than a shelf page.
  expect(shelf.volumeId).toBeNull()
  db.close()
})

test('an edition that collects nothing keeps its own name and year', () => {
  const db = openDb(':memory:')
  seed(db, 'Captain America (2025)', 15, { comicvineId: 165232, cvName: 'Captain America', cvStartYear: 2025 })
  const [shelf] = groupIntoShelves(listEditions(db))
  expect(shelf.name).toBe('Captain America (2025)')
  expect(shelf.startYear).toBe(2025)
  db.close()
})

test('an edition Comic Vine knows nothing about has no year to sort by', () => {
  const db = openDb(':memory:')
  seed(db, 'Some Scan', 1)
  const [shelf] = groupIntoShelves(listEditions(db))
  expect(shelf.name).toBe('Some Scan')
  expect(shelf.startYear).toBeNull()
  db.close()
})
