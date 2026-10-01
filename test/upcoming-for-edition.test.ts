import { test, expect } from 'vitest'
import { upcomingForEdition } from '../src/lib/upcomingForEdition'

function issue(headline: string, sourceId = headline) {
  return {
    sourceId,
    headline,
    seriesName: headline.replace(/\s*\(\d{4}\)\s*#.*$/, '').replace(/\s*#.*$/, ''),
  }
}

const CAP = { name: 'Captain America (2025)', seriesName: 'Captain America', cvStartYear: 2025 }

test('lists the issues of the volume, in week order', () => {
  const weeks = [
    { week: '2026-11-11', issues: [issue('Captain America (2025) #17')] },
    { week: '2026-10-28', issues: [issue('Captain America (2025) #16')] },
  ]

  expect(upcomingForEdition(weeks, CAP)).toEqual([
    {
      sourceId: 'Captain America (2025) #16',
      headline: 'Captain America (2025) #16',
      label: '#16',
      week: '2026-10-28',
    },
    {
      sourceId: 'Captain America (2025) #17',
      headline: 'Captain America (2025) #17',
      label: '#17',
      week: '2026-11-11',
    },
  ])
})

test('leaves out another series entirely', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('Daredevil (2025) #12')] }]

  expect(upcomingForEdition(weeks, CAP)).toEqual([])
})

test('leaves out a relaunch under the same name', () => {
  const weeks = [{
    week: '2027-01-06',
    issues: [issue('Captain America (2027) #1')],
  }]

  expect(upcomingForEdition(weeks, CAP)).toEqual([])
})

test('keeps an issue whose headline states no year', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('Captain America Annual #1')] }]
  const annuals = { ...CAP, seriesName: 'Captain America Annual' }

  expect(upcomingForEdition(weeks, annuals).map((i) => i.headline))
    .toEqual(['Captain America Annual #1'])
})

test('keeps a stated year when the edition has none of its own', () => {
  const weeks = [{ week: '2027-01-06', issues: [issue('Captain America (2027) #1')] }]
  const unmatched = { name: 'Captain America (2025)', seriesName: 'Captain America' }

  expect(upcomingForEdition(weeks, unmatched).map((i) => i.headline))
    .toEqual(['Captain America (2027) #1'])
})

test('matches a headline shouted in capitals', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('CAPTAIN AMERICA (2025) #16')] }]

  expect(upcomingForEdition(weeks, CAP).map((i) => i.headline))
    .toEqual(['CAPTAIN AMERICA (2025) #16'])
})

test('matches across a leading "The" and differing punctuation', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('The Amazing Spider-Man (2025) #12')] }]
  const asm = { name: 'Vol 7', seriesName: 'Amazing Spider Man', cvStartYear: 2025 }

  expect(upcomingForEdition(weeks, asm).map((i) => i.headline))
    .toEqual(['The Amazing Spider-Man (2025) #12'])
})

/* ── Naming an issue on the page of the volume it belongs to ──────────────── */

// The sidebar of a volume page repeats "The Amazing Spider-Man (2025)" on every row of a
// list that is, by construction, entirely that volume. The label is what is left once the
// series the page is already about is taken away.
test('each issue carries a label that is just its number', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('Captain America (2025) #16')] }]

  expect(upcomingForEdition(weeks, CAP)[0].label).toBe('#16')
})

// A solicitation that states no number at all, which the calendar does carry. "" is not
// a name for anything, so the whole headline stands in.
test('an issue with no number keeps its whole headline as its label', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('Captain America (2025)')] }]

  expect(upcomingForEdition(weeks, CAP)[0].label).toBe('Captain America (2025)')
})

test('the full headline is still carried for anywhere that wants it', () => {
  const weeks = [{ week: '2026-10-28', issues: [issue('Captain America (2025) #16')] }]

  expect(upcomingForEdition(weeks, CAP)[0].headline).toBe('Captain America (2025) #16')
})
