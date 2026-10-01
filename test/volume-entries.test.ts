import { test, expect } from 'vitest'
import { volumeEntries } from '../src/lib/volumeEntries'
import type { ApiBook } from '../src/api'

function book(id: number, over: Partial<ApiBook> = {}): ApiBook {
  return {
    id,
    editionId: 9,
    title: null,
    number: null,
    pageCount: 22,
    comicinfoSynced: false,
    ...over,
  }
}

test('an issue you own carries its book, its cover and a way to read it', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: true, bookId: 77 }],
    extras: [],
    books: [book(77, { title: 'The Eighth Day', readState: 'reading', percent: 60 })],
  })

  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({
    label: '#12',
    owned: true,
    bookId: 77,
    title: 'The Eighth Day',
    coverUrl: '/api/books/77/thumbnail',
    readTo: '/read/77',
    readState: 'reading',
    percent: 60,
  })
})

// A cover is a spoiler for a comic you have not read, and a gap is one you certainly
// have not. It carries no art and nothing to open.
test('a gap carries no cover and nothing to read', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: false, siteUrl: 'https://cv/12' }],
    extras: [],
    books: [],
  })

  expect(entries[0]).toMatchObject({ label: '#12', owned: false, siteUrl: 'https://cv/12' })
  expect(entries[0].coverUrl).toBeUndefined()
  expect(entries[0].readTo).toBeUndefined()
})

test('a gap keeps what is needed to fill it', () => {
  const entries = volumeEntries({
    issues: [{
      id: 500, number: '12', owned: false, coverDate: '2026-01-15',
      match: { indexId: 77, title: 'Venom #12 (2025)' },
    }],
    extras: [],
    books: [],
  })

  expect(entries[0]).toMatchObject({
    issueId: 500,
    coverDate: '2026-01-15',
    match: { indexId: 77, title: 'Venom #12 (2025)' },
  })
})

// Comic Vine records a story title for only a fraction of issues, and it is the gap's
// only name beyond its number.
test('a gap takes its story title from Comic Vine', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: false, name: 'Naked and Afraid' }],
    extras: [],
    books: [],
  })

  expect(entries[0].title).toBe('Naked and Afraid')
})

// A comic you own must never disappear because Comic Vine has not heard of it.
test('books outside the run follow it, in the order given', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '1', owned: true, bookId: 1 }],
    extras: [{ bookId: 99, number: 'Annual 1', title: 'Annual' }],
    books: [book(1), book(99, { title: 'Annual' })],
  })

  expect(entries.map((e) => e.label)).toEqual(['#1', 'Annual'])
  expect(entries[1]).toMatchObject({ bookId: 99, owned: true, readTo: '/read/99' })
})

// An edition with no Comic Vine volume has no run to walk, only the comics in it.
test('an edition with no run falls back to the books it holds', () => {
  const entries = volumeEntries({
    issues: [],
    extras: [],
    books: [book(5, { title: 'Issue one', number: '1' }), book(6, { number: '2' })],
  })

  expect(entries.map((e) => e.label)).toEqual(['Issue one', '#2'])
  expect(entries[0]).toMatchObject({ bookId: 5, owned: true })
})

// A comic with no metadata has no title and no number, and "#?" says nothing about
// which comic it is.
test('a comic with nothing known is labelled with its filename', () => {
  const entries = volumeEntries({
    issues: [],
    extras: [],
    books: [book(46, { filePath: 'Venom/Venom (2025)/Venom 999 (2026).cbz' })],
  })

  expect(entries[0].label).toBe('Venom 999 (2026)')
})

test('an issue you own takes its date and length from the book', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: true, bookId: 77, coverDate: '2025-08-01' }],
    extras: [],
    books: [book(77, { date: '2025-08-13', pageCount: 24, summary: 'Peter faces the eighth day.' })],
  })

  expect(entries[0]).toMatchObject({
    date: '2025-08-13',
    pageCount: 24,
    summary: 'Peter faces the eighth day.',
  })
})

// The run says an issue is owned, but the book behind it is on a page the read filter
// excluded or has not arrived. Drawing a cover for a book we do not hold is a broken
// image; the entry has to degrade to what a gap looks like.
test('an owned issue whose book is not here keeps its place without pretending to art', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: true, bookId: 77 }],
    extras: [],
    books: [],
  })

  expect(entries[0]).toMatchObject({ label: '#12', owned: true })
  expect(entries[0].coverUrl).toBeUndefined()
  expect(entries[0].readTo).toBeUndefined()
})

test('an issue with no number at all is still labelled', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, owned: false }],
    extras: [],
    books: [],
  })

  expect(entries[0].label).toBe('#?')
})

// Same rule as the run: no book here means no cover and no link, whichever list the
// entry came from. A thumbnail URL for a book the page does not hold is a broken image.
test('a book outside the run that is not here loses its cover too', () => {
  const entries = volumeEntries({
    issues: [],
    extras: [{ bookId: 99, number: 'Annual 1', title: 'Annual' }],
    books: [],
  })

  expect(entries[0]).toMatchObject({ label: 'Annual', owned: true })
  expect(entries[0].coverUrl).toBeUndefined()
  expect(entries[0].readTo).toBeUndefined()
})

// The subline on the issue's own page names the year and the publisher, so the carousel
// needs them carried too.
test('an owned issue carries its publisher, year and whether the file holds its metadata', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: true, bookId: 77 }],
    extras: [],
    books: [book(77, {
      publisher: 'Marvel', year: 2026, comicinfoSynced: true,
      writer: 'Joe Kelly', penciller: 'Pepe Larraz',
    })],
  })

  expect(entries[0]).toMatchObject({
    publisher: 'Marvel',
    year: 2026,
    comicinfoSynced: true,
    writer: 'Joe Kelly',
    penciller: 'Pepe Larraz',
  })
})

// A gap has no file, so it cannot claim its metadata is embedded in one.
test('a gap claims no embedded metadata', () => {
  const entries = volumeEntries({
    issues: [{ id: 500, number: '12', owned: false }],
    extras: [],
    books: [],
  })

  expect(entries[0].comicinfoSynced).toBeFalsy()
})
