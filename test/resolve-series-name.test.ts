import { test, expect } from 'vitest'
import { openDb } from '../server/db.js'
import { upsertEdition, updateEdition, getEdition, resolveSeriesName } from '../server/models/editions.js'
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

/**
 * A limited series is its own volume but not its own franchise. Left alone, every
 * Avengers mini becomes another series on the home shelf - four of them already were.
 */
test('a mini files under the franchise it belongs to, when you have it', () => {
  const db = openDb(':memory:')
  seed(db, 'Avengers (2025)')
  expect(resolveSeriesName(db, 'Avengers: Armageddon (2026)')).toBe('Avengers')
  db.close()
})

test('a dash subtitle files the same way, from the first break', () => {
  const db = openDb(':memory:')
  seed(db, 'Batman (2025)')
  expect(resolveSeriesName(db, 'Batman: Bad Seeds - Sunset (2026)')).toBe('Batman')
  db.close()
})

/**
 * The counterexample the rule exists to survive. "Miles Morales: Spider-Man" has the
 * same shape as "Avengers: Armageddon" and the opposite meaning - the colon is part of
 * the title, not a subtitle on a franchise. Nothing but the library can tell them
 * apart, which is why only a series you already own is ever adopted.
 */
test('a title that merely contains a colon is left alone', () => {
  const db = openDb(':memory:')
  seed(db, 'Venom (2025)')
  expect(resolveSeriesName(db, 'Miles Morales: Spider-Man (2026)')).toBe('Miles Morales: Spider-Man')
  db.close()
})

test('a crossover is not filed under half of itself', () => {
  const db = openDb(':memory:')
  seed(db, 'The Amazing Spider-Man (2025)')
  expect(resolveSeriesName(db, 'Amazing Spider-Man/Venom: Death Spiral (2026)'))
    .toBe('Amazing Spider-Man/Venom: Death Spiral')
  db.close()
})

test('a second volume of the same mini follows it onto the franchise shelf', () => {
  const db = openDb(':memory:')
  seed(db, 'Avengers (2025)')
  seed(db, 'Avengers: Armageddon (2026)')
  expect(resolveSeriesName(db, 'Avengers: Armageddon (2027)')).toBe('Avengers')
  db.close()
})

// An exact match is still tried first, so a franchise never swallows a series that
// genuinely exists under the longer name.
test('a series that exists under the full name keeps it', () => {
  const db = openDb(':memory:')
  seed(db, 'Batman (2025)')
  const bad = upsertEdition(db, { name: 'Batman: Bad Seeds (2026)', folder: 'x' })
  updateEdition(db, bad.id, { seriesName: 'Batman: Bad Seeds' })
  expect(resolveSeriesName(db, 'Batman: Bad Seeds (2027)')).toBe('Batman: Bad Seeds')
  db.close()
})

test('with no franchise in the library the full name stands', () => {
  const db = openDb(':memory:')
  expect(resolveSeriesName(db, 'Avengers: Armageddon (2026)')).toBe('Avengers: Armageddon')
  db.close()
})

// "Limited" is not a new judgement: it is the one resolveSeriesName already made.
// Having to strip a subtitle to find the franchise IS what makes an edition a mini of
// it, so the flag falls out of the same step rather than needing a rule of its own.
test('an edition filed under a franchise by its subtitle is marked limited', () => {
  const db = openDb(':memory:')
  seed(db, 'Avengers (2025)')
  const mini = seed(db, 'Avengers: Armageddon (2026)')
  expect(getEdition(db, mini.id)!.limited).toBe(true)
  db.close()
})

test('a run of the series itself is not limited', () => {
  const db = openDb(':memory:')
  const run = seed(db, 'Avengers (2025)')
  expect(getEdition(db, run.id)!.limited).toBe(false)
  db.close()
})

// Comic Vine calls the run "The Amazing Spider-Man" and its annual "Amazing Spider-Man
// Annual". Adopting the run's spelling is an article away, not a subtitle - so an
// annual is not a limited series.
test('an annual adopting the run spelling is not limited', () => {
  const db = openDb(':memory:')
  seed(db, 'The Amazing Spider-Man (2025)')
  const annual = seed(db, 'Amazing Spider-Man Annual (2026)')
  expect(getEdition(db, annual.id)!.limited).toBe(false)
  db.close()
})

// deriveSeriesName already cuts "by Jonathan Hickman: The Complete Collection" down to
// "Avengers", so a collection never looked like a mini in the first place.
test('a complete collection of the run is not limited', () => {
  const db = openDb(':memory:')
  seed(db, 'Avengers (2025)')
  const coll = seed(db, 'Avengers by Jonathan Hickman: The Complete Collection (2020)')
  expect(getEdition(db, coll.id)!.limited).toBe(false)
  db.close()
})

test('a title that kept its own name is not limited either', () => {
  const db = openDb(':memory:')
  seed(db, 'Venom (2025)')
  const miles = seed(db, 'Miles Morales: Spider-Man (2026)')
  expect(getEdition(db, miles.id)!.limited).toBe(false)
  db.close()
})

test('the guess can be overruled by hand', () => {
  const db = openDb(':memory:')
  seed(db, 'Avengers (2025)')
  const mini = seed(db, 'Avengers: Armageddon (2026)')
  updateEdition(db, mini.id, { limited: false })
  expect(getEdition(db, mini.id)!.limited).toBe(false)
  db.close()
})
