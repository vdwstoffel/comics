import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, resolveSeriesName } from '../server/models/editions.js'
import type { Db } from '../server/types.js'

function seed(db: Db, name: string) {
  return upsertEdition(db, { name, folder: name })
}

test('a new series keeps the name derived from the edition', () => {
  const db = openDb(':memory:')
  expect(resolveSeriesName(db, 'Venom (2025)')).toBe('Venom')
})

/**
 * The case that sent the Amazing Spider-Man annual to a shelf of its own: Comic Vine
 * calls the run "The Amazing Spider-Man" and its annual "Amazing Spider-Man Annual", so
 * the derived names differ by an article and nothing else.
 */
test('an annual takes the spelling of the run already in the library', () => {
  const db = openDb(':memory:')
  seed(db, 'The Amazing Spider-Man (2025)')

  expect(resolveSeriesName(db, 'Amazing Spider-Man Annual (2026)')).toBe('The Amazing Spider-Man')
})

test('the article is matched in both directions', () => {
  const db = openDb(':memory:')
  seed(db, 'Amazing Spider-Man (2025)')

  expect(resolveSeriesName(db, 'The Amazing Spider-Man Annual (2026)')).toBe('Amazing Spider-Man')
})

test('an unrelated series is never adopted', () => {
  const db = openDb(':memory:')
  seed(db, 'Batman (2025)')

  expect(resolveSeriesName(db, 'Venom Annual (2026)')).toBe('Venom')
})

test('a series spelled the same way is returned unchanged', () => {
  const db = openDb(':memory:')
  seed(db, 'Venom (2025)')

  expect(resolveSeriesName(db, 'Venom Annual (2026)')).toBe('Venom')
})

test('an added annual is stored under the run it belongs to', () => {
  const db = openDb(':memory:')
  seed(db, 'The Amazing Spider-Man (2025)')

  const annual = seed(db, 'Amazing Spider-Man Annual (2026)')

  expect(annual.seriesName).toBe('The Amazing Spider-Man')
})

test('a series given by hand is not second-guessed', () => {
  const db = openDb(':memory:')
  seed(db, 'The Amazing Spider-Man (2025)')

  const annual = upsertEdition(db, {
    name: 'Amazing Spider-Man Annual (2026)',
    folder: 'x',
    seriesName: 'Spider-Man Annuals',
  })

  expect(annual.seriesName).toBe('Spider-Man Annuals')
})
