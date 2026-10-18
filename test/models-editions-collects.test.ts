import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import {
  upsertEdition,
  updateEdition,
  getEdition,
  carryableMetadata,
} from '../server/models/editions.js'

test('an edition stores and reads back what it collects', () => {
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Amazing Spider-Man By Zeb Wells (2023)', folder: 'x' })
  updateEdition(db, e.id, {
    collectsVolumeId: 142577,
    collectsCvName: 'The Amazing Spider-Man',
    collectsCvStartYear: 2022,
    collectsCvSiteUrl: 'https://comicvine.gamespot.com/the-amazing-spider-man/4050-142577/',
  })
  const back = getEdition(db, e.id)!
  expect(back.collectsVolumeId).toBe(142577)
  expect(back.collectsCvStartYear).toBe(2022)
  // What it IS stays untouched by what it reprints - the whole point of a second column.
  expect(back.comicvineId).toBeNull()
  db.close()
})

test('a rename carries the collects link to the new row', () => {
  // carryableMetadata is derived from EDITION_FIELDS; assert the link survives it
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Old name', folder: 'Old name' })
  updateEdition(db, e.id, { collectsVolumeId: 142577 })
  expect(carryableMetadata(getEdition(db, e.id)!).collectsVolumeId).toBe(142577)
  db.close()
})

test('checked-at records a look that found nothing, distinct from never looking', () => {
  const db = openDb(':memory:')
  const e = upsertEdition(db, { name: 'Untouched', folder: 'Untouched' })
  expect(getEdition(db, e.id)!.collectsCheckedAt).toBeNull()
  updateEdition(db, e.id, { collectsCheckedAt: '2026-10-18T00:00:00.000Z' })
  const back = getEdition(db, e.id)!
  expect(back.collectsCheckedAt).toBe('2026-10-18T00:00:00.000Z')
  expect(back.collectsVolumeId).toBeNull()
  db.close()
})
