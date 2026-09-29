import { test, expect } from 'vitest'
import { splitAnnuals, annualYear } from '../src/lib/annuals'

function ed(name: string, id = 1) {
  return { id, name, bookCount: 1 }
}

test('a series with no annuals keeps every edition in the run', () => {
  const editions = [ed('The Amazing Spider-Man (2025)', 1), ed('Amazing Spider-Man Omnibus', 2)]

  expect(splitAnnuals(editions)).toEqual({ runs: editions, annuals: [] })
})

test('an annual is taken out of the run', () => {
  const run = ed('The Amazing Spider-Man (2025)', 1)
  const annual = ed('Amazing Spider-Man Annual (2026)', 2)

  expect(splitAnnuals([run, annual])).toEqual({ runs: [run], annuals: [annual] })
})

test('an annual with no year is an annual too', () => {
  const annual = ed('Amazing Spider-Man Annual', 2)

  expect(splitAnnuals([annual]).annuals).toEqual([annual])
})

test('a plural annuals volume is an annual', () => {
  const annual = ed('X-Men Annuals (2026)', 2)

  expect(splitAnnuals([annual]).annuals).toEqual([annual])
})

// "Annual" has to be the last word of the name, or a run that merely mentions it -
// Marvel has published "Annual Report" one-shots - would be filed as one.
test('a name that only contains the word annual stays in the run', () => {
  const run = ed('The Annual Report (2026)', 1)

  expect(splitAnnuals([run])).toEqual({ runs: [run], annuals: [] })
})

test('the order of each list is the order they came in', () => {
  const a = ed('Venom Annual (2026)', 1)
  const b = ed('Venom (2025)', 2)
  const c = ed('Venom Annual (2027)', 3)

  expect(splitAnnuals([a, b, c])).toEqual({ runs: [b], annuals: [a, c] })
})

test('an annual is named by the year in its name', () => {
  expect(annualYear('Amazing Spider-Man Annual (2026)')).toBe('2026')
  expect(annualYear('The Amazing Spider-Man Annual (2024)')).toBe('2024')
})

test('an annual with no year in its name has none', () => {
  expect(annualYear('Amazing Spider-Man Annual')).toBe(null)
})
