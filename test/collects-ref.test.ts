import { test, expect } from 'vitest'
import { volumeRefFromDescription, collectingLineFromIssue } from '../server/lib/collectsRef.js'

// Comic Vine's own words, read from the live API on 2026-10-18. Trimmed in the middle
// where the pattern simply repeats; the shape is exactly what came back.
const ZEB_WELLS_DESC = `<p>Series of trade paperbacks collecting <a href="/the-amazing-spider-man/4050-142577/" data-ref-id="4050-142577">The Amazing Spider-Man</a></p><ul><li>Volume 4: <a href="/the-amazing-spider-man/4050-142577/" data-ref-id="4050-142577">The Amazing Spider-Man</a> #15-18, <a href="https://comicvine.gamespot.com/dark-web/4050-146735/">Dark Web</a> and <a href="https://comicvine.gamespot.com/dark-web-finale/4050-147905/">Dark Web: Finale</a></li></ul><ul><li>Volume 5: <a href="/the-amazing-spider-man/4050-142577/" data-ref-id="4050-142577">The Amazing Spider-Man</a> #19-23</li></ul><p>Continued from <a href="/the-amazing-spider-man-by-wells-and-romita-jr/4050-149382/" data-ref-id="4050-149382">The Amazing Spider-Man by Wells and Romita Jr.</a></p>`

const WELLS_ROMITA_DESC = `<p>Collects <a href="/amazing-spider-man/4050-142577/" data-ref-id="4050-142577">Amazing Spider-Man</a> (2022).</p><p>Continued on in <a href="/amazing-spider-man-by-zeb-wells/4050-150443/" data-ref-id="4050-150443">Amazing Spider-Man By Zeb Wells</a></p>`

const EIGHT_DEATHS_ISSUE_DESC = `<p><em>Amidst a darker Marvel Universe, Spider-Man is forced on a spellbinding adventure that will cost him his life!</em></p><p><em>COLLECTING: Amazing Spider-Man (2022) 61-70</em></p>`

test('a collecting verb picks the volume out of the description', () => {
  expect(volumeRefFromDescription(ZEB_WELLS_DESC)).toBe(142577)
  expect(volumeRefFromDescription(WELLS_ROMITA_DESC)).toBe(142577)
})

// Review Focus 4. Both of the real descriptions also link the OTHER half of the same
// trade line, and on "by Wells and Romita Jr." the two candidates are tied at one
// reference each - so "most-referenced volume" is not the rule.
test('a sibling link with no collecting verb is not an answer', () => {
  expect(volumeRefFromDescription(
    '<p>Continued on in <a data-ref-id="4050-150443">Zeb Wells</a></p>',
  )).toBeNull()
})

test('the collecting verb wins over a sibling named before it', () => {
  expect(volumeRefFromDescription(
    '<p>Continued from <a data-ref-id="4050-149382">Wells</a>. Collects <a data-ref-id="4050-142577">ASM</a>.</p>',
  )).toBe(142577)
})

// The 8 Deaths of Spider-Man has none at all, which is why source two exists.
test('an empty description answers nothing', () => {
  expect(volumeRefFromDescription('')).toBeNull()
  expect(volumeRefFromDescription('<p>A trade paperback.</p>')).toBeNull()
})

test('an issue reference is not mistaken for a volume', () => {
  expect(volumeRefFromDescription(
    '<p>Collects <a data-ref-id="4000-1004319">Annual #1</a></p>',
  )).toBeNull()
})

test('the collecting line gives a name and a year', () => {
  expect(collectingLineFromIssue(EIGHT_DEATHS_ISSUE_DESC))
    .toEqual({ name: 'Amazing Spider-Man', startYear: 2022 })
})

test('a collecting line with no year still names the run', () => {
  expect(collectingLineFromIssue('<p>COLLECTING: Daredevil 1-6</p>'))
    .toEqual({ name: 'Daredevil', startYear: null })
})

test('a description with no collecting line answers nothing', () => {
  expect(collectingLineFromIssue('<p>Spider-Man fights the Green Goblin.</p>')).toBeNull()
  expect(collectingLineFromIssue('')).toBeNull()
})
