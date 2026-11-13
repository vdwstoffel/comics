import { test, expect } from 'vitest'
import { READING_LISTS } from '../server/readingLists/index.js'
import { phaseIssues } from '../server/models/readingLists.js'

// The lists themselves, not a fixture: a list is a file Claude writes, and this is what
// stops a bad one at the merge rather than on the page. The typechecker has already said
// each one has the right shape; these are the rules a shape cannot state.

const each = READING_LISTS.map((l) => [l.name, l] as const)

test('every list has an id and a slug no other list has', () => {
  const ids = READING_LISTS.map((l) => l.id)
  const slugs = READING_LISTS.map((l) => l.slug)
  expect(new Set(ids).size).toBe(ids.length)
  expect(new Set(slugs).size).toBe(slugs.length)
  for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
})

test.each(each)('%s holds each issue once', (_name, list) => {
  const ids = list.phases.flatMap((p) => phaseIssues(p).map((i) => i.cv))
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
  expect(dupes).toEqual([])
})

// A phase is a fold on the page, keyed by its name, and an empty one would be a bar with
// nothing behind it - as would an empty section be a heading over nothing.
test.each(each)('%s has named, non-empty phases and sections', (_name, list) => {
  const names = list.phases.map((p) => p.name)
  expect(new Set(names).size).toBe(names.length)
  for (const phase of list.phases) {
    expect(phaseIssues(phase).length, phase.name).toBeGreaterThan(0)
    for (const section of phase.sections ?? []) {
      expect(section.issues.length, `${phase.name}: ${section.name}`).toBeGreaterThan(0)
    }
  }
})

// Core is the story. A list whose every issue is a tie-in has no story to read short.
test.each(each)('%s has a core', (_name, list) => {
  expect(list.phases.some((p) => phaseIssues(p).some((i) => !i.extra))).toBe(true)
})

test.each(each)('%s names every issue the way a download needs', (_name, list) => {
  for (const issue of list.phases.flatMap(phaseIssues)) {
    expect(issue.volume, `${issue.cv}`).not.toBe('')
    expect(issue.number, `${issue.cv}`).not.toBe('')
    expect(Number.isInteger(issue.volumeId), `${issue.cv}`).toBe(true)
  }
})
