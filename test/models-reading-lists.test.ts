import { test, expect, vi } from 'vitest'
import { openDb } from '../server/db.js'
import {
  phasesIn, phaseIssues, issuesIn, hasExtras, nextIssueIndex, getListLength, setListLength,
  bookReadingLists, listsHolding, findReadingListIssue, getReadingListBySlug, getReadingListById,
} from '../server/models/readingLists.js'
import { LIST } from './helpers/readingListFixture.js'

vi.mock('../server/readingLists/index.js', async () =>
  ({ READING_LISTS: [(await import('./helpers/readingListFixture.js')).LIST] }))

const cvs = (issues: Array<{ cv: number }>) => issues.map((i) => i.cv)

test('Core leaves the tie-ins out, and a phase of nothing but tie-ins with them', () => {
  expect(phasesIn(LIST, 'core').map((p) => p.name)).toEqual(['One', 'Two'])
  expect(cvs(issuesIn(LIST, 'core'))).toEqual([101, 102, 103])
})

test('Full reads every issue, where the list puts it', () => {
  expect(phasesIn(LIST, 'full').map((p) => p.name)).toEqual(['One', 'Tie-ins only', 'Two'])
  expect(cvs(issuesIn(LIST, 'full'))).toEqual([101, 901, 102, 902, 103, 904])
})

// Core drops the section that held only a tie-in, and keeps the phase as what is left.
test('a split phase loses its tie-in-only section in Core, and keeps both in Full', () => {
  const sections = (length: 'core' | 'full') =>
    phasesIn(LIST, length).find((p) => p.name === 'Two')?.sections?.map((s) => s.name)
  expect(sections('core')).toEqual(['Last Days'])
  expect(sections('full')).toEqual(['Last Days', 'Battleworld'])
  expect(cvs(phaseIssues(LIST.phases[2]))).toEqual([103, 904])
})

test('a list knows whether it has anything to switch between', () => {
  expect(hasExtras(LIST)).toBe(true)
  expect(hasExtras({ ...LIST, phases: [phasesIn(LIST, 'core')[0]] })).toBe(false)
})

// The follow's rule: after the LAST issue you finished, so a gap behind you stays skipped.
test('the next issue is the one after the last you finished', () => {
  const core = issuesIn(LIST, 'core')
  expect(nextIssueIndex(core, new Set())).toBe(0)
  expect(nextIssueIndex(core, new Set([101]))).toBe(1)
  expect(nextIssueIndex(core, new Set([102]))).toBe(2)
  expect(nextIssueIndex(core, new Set([101, 102, 103]))).toBe(3)
})

test('a list reads in Core until you say otherwise, and remembers what you said', () => {
  const db = openDb(':memory:')
  expect(getListLength(db, LIST.id)).toBe('core')
  setListLength(db, LIST.id, 'full')
  expect(getListLength(db, LIST.id)).toBe('full')
  setListLength(db, LIST.id, 'core')
  expect(getListLength(db, LIST.id)).toBe('core')
})

test('an issue is found by its Comic Vine id, and so are the lists holding it', () => {
  expect(findReadingListIssue(902)).toMatchObject({ volume: 'Infinity: The Hunt', extra: true })
  expect(findReadingListIssue(5)).toBeUndefined()
  expect(findReadingListIssue(904)).toMatchObject({ volume: 'Secret Wars Journal' })
  expect(listsHolding(904).map((l) => l.slug)).toEqual(['test-list'])
  expect(listsHolding(101).map((l) => l.slug)).toEqual(['test-list'])
  expect(listsHolding(5)).toEqual([])
  expect(getReadingListBySlug('test-list')?.id).toBe(7)
  expect(getReadingListById(7)?.slug).toBe('test-list')
})

// "47 of 92" is counted in the length the list is read in, so it agrees with the page.
test("an issue's place in a list is counted in that list's length", () => {
  const db = openDb(':memory:')
  expect(bookReadingLists(db, 102)).toEqual([{ slug: 'test-list', name: 'Test List', position: 2, total: 3 }])
  setListLength(db, LIST.id, 'full')
  expect(bookReadingLists(db, 102)).toEqual([{ slug: 'test-list', name: 'Test List', position: 3, total: 6 }])
})

test('a tie-in while the list reads in Core says so instead of a place', () => {
  const db = openDb(':memory:')
  expect(bookReadingLists(db, 901)).toEqual([{ slug: 'test-list', name: 'Test List', tieIn: true, total: 3 }])
})

test('a comic in no list, or never matched, is in no list', () => {
  const db = openDb(':memory:')
  expect(bookReadingLists(db, 5)).toEqual([])
  expect(bookReadingLists(db, null)).toEqual([])
})
