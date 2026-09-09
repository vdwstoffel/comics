import { test, expect } from 'vitest'
import { seriesKey, releaseKind, displayName } from '../server/lib/comicGrouping.js'

// ---- seriesKey: what lands in the same bucket ----

test('an issue and its series share a key', () => {
  expect(seriesKey('Thor #1 (2018)')).toBe('thor')
  expect(seriesKey('Thor #35 (2023)')).toBe('thor')
})

test('a leading "The" does not split a series', () => {
  expect(seriesKey('The Mighty Thor #700 (2017)')).toBe(seriesKey('Mighty Thor #1 (2011)'))
})

test('casing does not split a series', () => {
  expect(seriesKey('Ash And Thorn #1 (2020)')).toBe(seriesKey('Ash and Thorn #2 (2020)'))
})

test('a volume marker does not split a series', () => {
  expect(seriesKey('Dejah Thoris Vol. 4 #1 (2018)')).toBe(seriesKey('Dejah Thoris #1 (2019)'))
})

test('a subtitled offshoot folds into its parent series', () => {
  expect(seriesKey('Thor – Godstorm #1 – 3 (2001-2002)')).toBe('thor')
  expect(seriesKey('Thor – Blood Oath #1 – 6 (2005-2006)')).toBe('thor')
})

test('a trailing parenthetical is not part of the key', () => {
  expect(seriesKey('Astonishing Thor (TPB) (2011)')).toBe('astonishing thor')
  expect(seriesKey('Thor – Truth of History #1 (2008) (One Shot)')).toBe('thor')
})

test('unrelated series stay apart', () => {
  const keys = ['Thor #1 (2018)', 'The Mortal Thor #1 (2025)', 'Red Thorn #1 (2015)']
    .map(seriesKey)
  expect(new Set(keys).size).toBe(3)
})

test('a title that is nothing but strippable markers keeps something to group on', () => {
  expect(seriesKey('Vol. 1 (TPB) (2020)')).not.toBe('')
})

// ---- releaseKind: checked in order, first match wins ----

test('a plain numbered issue is an issue', () => {
  expect(releaseKind('Thor #1 (2018)')).toBe('issue')
})

test('a run of issues in one post is a bundle', () => {
  expect(releaseKind('Thor Vol. 1 #126 – 502 (1966-1996)')).toBe('bundle')
})

test('a bundle that also mentions its collections is still a bundle', () => {
  expect(releaseKind('Thor Vol. 2 #1 – 85 + TPBs (1998-2004)')).toBe('bundle')
})

test('a collected edition is a collection', () => {
  expect(releaseKind('Astonishing Thor (TPB) (2011)')).toBe('collection')
  expect(releaseKind('The Mighty Thor Omnibus Vol. 2 (2013)')).toBe('collection')
  expect(releaseKind('Thor Epic Collection Vol. 33 (2020)')).toBe('collection')
})

test('a subtitled numbered issue is a miniseries, not part of the series numbering', () => {
  expect(releaseKind('Thor – Ages of Thunder #1 (2008)')).toBe('miniseries')
  expect(releaseKind('Thor – Crown of Fools #1 (2013)')).toBe('miniseries')
})

test('an unsubtitled numbered issue stays an issue', () => {
  expect(releaseKind('Thor #1 (2018)')).toBe('issue')
  expect(releaseKind('Spider-Man #10 (2016)')).toBe('issue')
})

test('a subtitled run of issues is still a bundle', () => {
  expect(releaseKind('Thor – Godstorm #1 – 3 (2001)')).toBe('bundle')
})

test('a subtitled collection is still a collection', () => {
  expect(releaseKind('Dejah Thoris – Crimson Genesis (TPB) (2020)')).toBe('collection')
})

test('a one-shot with no number and no collection marker is other', () => {
  expect(releaseKind('Marvel’s Thor – The Dark World Prelude (2013)')).toBe('other')
})

test('every title gets exactly one kind', () => {
  const titles = [
    'Thor #1 (2018)', 'Thor Vol. 2 #1 – 85 + TPBs (1998-2004)',
    'Astonishing Thor (TPB) (2011)', 'Poison Ivy – Thorns (2021)',
  ]
  expect(titles.map(releaseKind)).toEqual(['issue', 'bundle', 'collection', 'other'])
})

test('a hyphenated name is not mistaken for a subtitle', () => {
  expect(releaseKind('Spider-Man #10 (2016)')).toBe('issue')
  expect(releaseKind('X-Men #1 (2021)')).toBe('issue')
})

// ---- displayName: the label a group wears ----

test('the most common casing wins the label', () => {
  expect(displayName(['Ash and Thorn #1', 'Ash and Thorn #2', 'Ash And Thorn #3']))
    .toBe('Ash and Thorn')
})

test('a single member supplies its own label', () => {
  expect(displayName(['Astonishing Thor (TPB) (2011)'])).toBe('Astonishing Thor')
})

test('the label keeps the leading "The" the titles actually use', () => {
  expect(displayName(['The Mighty Thor #700', 'The Mighty Thor #701'])).toBe('The Mighty Thor')
})
