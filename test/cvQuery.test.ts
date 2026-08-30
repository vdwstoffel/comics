import { test, expect } from 'vitest'
import { buildCvQuery } from '../src/lib/cvQuery'
import type { ApiBook, ApiEdition } from '../src/api'

const book = (over: Partial<ApiBook> = {}): ApiBook => ({
  id: 1, editionId: 12, title: null, number: null, pageCount: 20, comicinfoSynced: false, ...over,
})
const edition = (over: Partial<ApiEdition> = {}): ApiEdition => ({
  id: 12, name: 'Vol 7', ...over,
})

// The case that prompted this: a freshly imported file carries no ComicInfo, so the
// book has neither title nor number and everything has to come off the file name.
test('an untitled import searches for its series and the number in the file name', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/Amazing Spider-Man 011 (2025) (Digital) (Shan-Empire).cbz' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man #11')
})

test('a number already on the book beats the one in the file name', () => {
  expect(buildCvQuery(
    book({ number: '10.1', filePath: 'Vol 7/Amazing Spider-Man 010 (2025) (Digital) (Shan-Empire).cbz' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man #10.1')
})

// seriesName is the one a human can correct by hand, so it outranks the file name.
test('the hand-set series name beats the one in the file name', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/ASM 011 (2025) (Shan-Empire).cbz' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man #11')
})

// "Vol 7" as a query finds nothing; the file name is what carries the series here.
test('an edition with no series name falls back to the file name, not the folder', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/Amazing Spider-Man 011 (2025) (Digital) (Shan-Empire).cbz' }),
    edition({ name: 'Vol 7' }),
  )).toBe('Amazing Spider-Man #11')
})

test('the edition name is the last resort when the file name yields no series', () => {
  expect(buildCvQuery(book({ filePath: '011.cbz' }), edition({ name: 'Vol 7' }))).toBe('Vol 7 #11')
})

// A collected edition has no issue number, so the cleaned file name is the whole query.
test('a trade with no number searches for its file name, minus the release tags', () => {
  expect(buildCvQuery(
    book({ filePath: 'Batman Vol. 2 (New 52 TPB)/Batman v04 - Zero Year - Secret City (2014) (Digital) (Zone-Empire).cbz' }),
    edition({ name: 'Batman Vol. 2 (New 52 TPB)', seriesName: 'Batman' }),
  )).toBe('Batman v04 - Zero Year - Secret City')
})

test('an omnibus volume marker is not mistaken for an issue number', () => {
  expect(buildCvQuery(
    book({ filePath: 'Nick Spencer Omnibus/Amazing Spider-Man by Nick Spencer Omnibus v02 (2024) (Digital-Empire).cbz' }),
    edition({ name: 'Nick Spencer Omnibus', seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man by Nick Spencer Omnibus v02')
})

test('a numbered omnibus keeps its series and number', () => {
  expect(buildCvQuery(
    book({ filePath: 'Spider-Man By Joe Kelly Omnibus/Spider-Man By Joe Kelly Omnibus 001 (2025) (digital) (Marika-Empire).cbz' }),
    edition({ name: 'Spider-Man By Joe Kelly Omnibus', seriesName: 'Spider-Man' }),
  )).toBe('Spider-Man #1')
})

// The issue title is a worse query than the series: Comic Vine's search matches volumes.
test('the issue title is not used, even when the book has one', () => {
  expect(buildCvQuery(
    book({ title: 'Death to the Task Master', number: '1' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man #1')
})

test('a decimal issue number survives the file name', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/Amazing Spider-Man 016.1 (2015).cbz' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).toBe('Amazing Spider-Man #16.1')
})

test('a series with no number at all searches for the series alone', () => {
  expect(buildCvQuery(book(), edition({ seriesName: 'Saga' }))).toBe('Saga')
})

test('a book with nothing to go on yields an empty query', () => {
  expect(buildCvQuery(book(), edition({ name: '' }))).toBe('')
})

// A year in the file name is not part of the query; Comic Vine matches it poorly and
// the field stays editable for anyone who wants to narrow it down.
test('the release year is left out of the query', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/Amazing Spider-Man 011 (2025).cbz' }),
    edition({ seriesName: 'Amazing Spider-Man' }),
  )).not.toContain('2025')
})

// The editions list loads separately, so the dialog can open before it has arrived.
test('a missing edition still yields the query the file name supports', () => {
  expect(buildCvQuery(
    book({ filePath: 'Vol 7/Amazing Spider-Man 011 (2025) (Digital) (Shan-Empire).cbz' }),
    undefined,
  )).toBe('Amazing Spider-Man #11')
})
