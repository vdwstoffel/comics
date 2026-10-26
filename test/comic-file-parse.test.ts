import { test, expect } from 'vitest'
import {
  parseComicFileName,
  normalizeIssueNumber,
  seriesKey,
  baseIssueNumber,
} from '../src/lib/comicFileParse'

// The shape the user's own folder arrives in: zero-padded number, cover year, a format
// tag and a group tag, none of which are part of the comic's identity.
test('the real folder: tags stripped, padding dropped', () => {
  expect(parseComicFileName('Avengers 020 (2013) (Digital) (Zone-Empire).cbr'))
    .toEqual({ series: 'Avengers', number: '20' })
})

// Marvel's branding rode on the cover, and the scene name carries it. Comic Vine calls
// this issue 24; keeping the suffix here is what lets the matcher try both.
test('a dotted suffix survives the parse', () => {
  expect(parseComicFileName('Avengers 024.NOW (2014) (Digital) (Zone-Empire).cbr'))
    .toEqual({ series: 'Avengers', number: '24.now' })
})

test('a collection has no trailing number', () => {
  expect(parseComicFileName('Avengers Omnibus.cbz'))
    .toEqual({ series: 'Avengers Omnibus', number: null })
})

test('bracketed tags come off as well as parenthesised ones', () => {
  expect(parseComicFileName('Avengers 020 [Digital].cbz').number).toBe('20')
})

test('a path is reduced to its basename', () => {
  expect(parseComicFileName('Avengers (2013)/Avengers 020 (2013).cbr').number).toBe('20')
})

test('normalizeIssueNumber folds padding and case', () => {
  expect(normalizeIssueNumber('020')).toBe('20')
  expect(normalizeIssueNumber('24.NOW')).toBe('24.now')
  expect(normalizeIssueNumber('16.1')).toBe('16.1')
  expect(normalizeIssueNumber('  7 ')).toBe('7')
})

test('normalizeIssueNumber reports nothing for a blank', () => {
  expect(normalizeIssueNumber('')).toBe(null)
  expect(normalizeIssueNumber(null)).toBe(null)
  expect(normalizeIssueNumber(undefined)).toBe(null)
})

// Comic Vine writes "The Uncanny X-Men" where a file says "Uncanny X-Men", and
// "Avengers: Armageddon" where a scrape says "Avengers – Armageddon".
test('seriesKey folds punctuation and a leading "the"', () => {
  expect(seriesKey('The Uncanny X-Men')).toBe(seriesKey('Uncanny X-Men'))
  expect(seriesKey('Avengers: Armageddon')).toBe(seriesKey('Avengers – Armageddon'))
})

// The distinction that must survive: a hyphen inside a word is part of the name.
test('seriesKey keeps a hyphen inside a word', () => {
  expect(seriesKey('Spider-Man')).not.toBe(seriesKey('Spider Man'))
})

// The guard in the rule: a title that is nothing but a parenthetical would strip to
// nothing, and two unrelated titles keying alike is how a wrong volume claims a file.
test('seriesKey keeps a title that would otherwise strip to nothing', () => {
  expect(seriesKey('(2011)')).toBe('(2011)')
  expect(seriesKey('(2011)')).not.toBe(seriesKey('(One Shot)'))
})

test('baseIssueNumber reports the part before the dot, or nothing', () => {
  expect(baseIssueNumber('24.now')).toBe('24')
  expect(baseIssueNumber('16.1')).toBe('16')
  expect(baseIssueNumber('24')).toBe(null)
})
