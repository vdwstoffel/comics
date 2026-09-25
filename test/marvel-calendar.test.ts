import { test, expect } from 'vitest'
import {
  calendarUrl, parseCalendar, sortUpcomingIssues, MARVEL, MARVEL_USER_AGENT,
} from '../server/lib/marvelCalendar.js'

/**
 * Synthetic, not a capture of the live page: the titles are invented, so these tests pin
 * the payload's *structure* and rot only when Marvel changes it rather than every week
 * when the solicitations move on.
 *
 * Every oddity below was measured against the real calendar on 2026-09-25 (see the design
 * spec, §3): three sibling buckets of which only the first is wanted, a variant that must
 * be excluded, an entry with no cover, a one-shot with no issue number, and an entry with
 * no link that cannot be keyed.
 */
function payload(inner: string): string {
  return `<html><body><script>window.x={"page":{"allComicsReleases":${inner},`
    + `"allCollectionsReleases":{"total":1,"content":[{"headline":"INVENTED OMNIBUS (Trade Paperback)",`
    + `"releaseDate":"2026-09-30","isVariant":0,"link":{"link":"https://www.marvel.com/comics/collection/1/x"}}]},`
    + `"allMUReleases":{"total":1,"content":[{"headline":"Invented MU (2026) #1","releaseDate":"2026-07-08",`
    + `"isVariant":0,"link":{"link":"https://www.marvel.com/comics/issue/999/mu"}}]}}}</script></body></html>`
}

const ENTRY = {
  creators_shortlist: 'Invented, Writer',
  headline: 'Invented Ongoing (2026) #12',
  isVariant: 0,
  releaseDate: '2026-09-30',
  image: { filename: 'https://cdn.marvel.com/x/a.jpg' },
  link: { link: 'https://www.marvel.com/comics/issue/134736/invented_ongoing_2026_12' },
}

const bucket = (content: unknown[]) =>
  payload(JSON.stringify({ total: content.length, content }))

test('builds a one-week url around the Wednesday, comics only, no variants', () => {
  const url = new URL(calendarUrl('2026-09-30'))
  expect(url.origin + url.pathname).toBe('https://www.marvel.com/comics/calendar')
  expect(url.searchParams.get('dateStart')).toBe('2026-09-27')
  expect(url.searchParams.get('dateEnd')).toBe('2026-10-03')
  expect(url.searchParams.get('tab')).toBe('comic')
  expect(url.searchParams.get('variants')).toBe('false')
})

test('reads every field from a comics entry', () => {
  const [issue] = parseCalendar(bucket([ENTRY]))
  expect(issue).toEqual({
    sourceId: '134736',
    headline: 'Invented Ongoing (2026) #12',
    seriesName: 'Invented Ongoing',
    number: '12',
    releaseDate: '2026-09-30',
    coverUrl: 'https://cdn.marvel.com/x/a.jpg',
    siteUrl: 'https://www.marvel.com/comics/issue/134736/invented_ongoing_2026_12',
    creators: 'Invented, Writer',
  })
})

// The collections and Marvel Unlimited buckets sit beside the one we want, and the MU
// bucket carries dates months away from the week asked for. Reading the wrong bucket
// would fill the week with comics that are not coming out then, or at all.
test('ignores the collections and Marvel Unlimited buckets', () => {
  const issues = parseCalendar(bucket([ENTRY]))
  expect(issues).toHaveLength(1)
  expect(issues[0]!.headline).toBe('Invented Ongoing (2026) #12')
})

test('drops variants even though the url already asks for none', () => {
  const variant = { ...ENTRY, isVariant: 1, link: { link: 'https://www.marvel.com/comics/issue/2/v' } }
  expect(parseCalendar(bucket([ENTRY, variant]))).toHaveLength(1)
})

// Review Focus 3: a one-shot has no "#N". It is a real comic and must still be shown.
test('a headline with no issue number parses with a null number and is kept', () => {
  const oneShot = {
    ...ENTRY,
    headline: 'Invented Special (2026)',
    link: { link: 'https://www.marvel.com/comics/issue/555/invented_special' },
  }
  const [issue] = parseCalendar(bucket([oneShot]))
  expect(issue!.number).toBeNull()
  expect(issue!.seriesName).toBe('Invented Special')
  expect(issue!.headline).toBe('Invented Special (2026)')
})

test('skips an entry with no link, which has no stable key', () => {
  const { link: _drop, ...noLink } = ENTRY
  expect(parseCalendar(bucket([ENTRY, noLink]))).toHaveLength(1)
})

test('skips an entry with no release date', () => {
  const { releaseDate: _drop, ...noDate } = ENTRY
  const undated = { ...noDate, link: { link: 'https://www.marvel.com/comics/issue/3/u' } }
  expect(parseCalendar(bucket([ENTRY, undated]))).toHaveLength(1)
})

test('a missing cover or creator list reads as null, not as a skipped issue', () => {
  const bare = {
    headline: 'Invented Bare (2026) #1',
    releaseDate: '2026-09-30',
    isVariant: 0,
    link: { link: 'https://www.marvel.com/comics/issue/77/invented_bare' },
  }
  const [issue] = parseCalendar(bucket([bare]))
  expect(issue!.coverUrl).toBeNull()
  expect(issue!.creators).toBeNull()
})

// An empty week is a real answer - the spec measured a three-issue week, so "few" never
// means "broken". Only a MISSING bucket means the page changed shape.
test('an empty content list parses to no issues rather than throwing', () => {
  expect(parseCalendar(bucket([]))).toEqual([])
})

test('a payload with no comics bucket throws rather than reading as an empty week', () => {
  expect(() => parseCalendar('<html><body>nothing here</body></html>')).toThrow()
})

test('orders by series then issue number, numerically', () => {
  const make = (headline: string, sourceId: string) => ({
    sourceId, headline, seriesName: headline.replace(/\s*#.*$/, ''),
    number: headline.split('#')[1] ?? null, releaseDate: '2026-09-30',
    coverUrl: null, siteUrl: `https://www.marvel.com/comics/issue/${sourceId}/x`, creators: null,
  })
  const sorted = sortUpcomingIssues([
    make('Invented Beta #2', '3'), make('Invented Alpha #10', '2'), make('Invented Alpha #9', '1'),
  ])
  expect(sorted.map((i) => i.headline)).toEqual([
    'Invented Alpha #9', 'Invented Alpha #10', 'Invented Beta #2',
  ])
})

test('names the publisher exactly as the other two tabs name it', () => {
  expect(MARVEL).toBe('Marvel')
})

/**
 * Review Focus 1. Marvel answers this app's own User-Agent - and a bare "Mozilla/5.0" -
 * with a 403, and answers the conventional "(compatible; ...)" form with the page. Every
 * other test in the suite injects a fake fetcher, so nothing else would ever notice a
 * route wired to the wrong one.
 */
test('identifies itself in the form Marvel accepts, without claiming to be a browser', () => {
  expect(MARVEL_USER_AGENT).toMatch(/^Mozilla\/5\.0 \(compatible;/)
  expect(MARVEL_USER_AGENT).toContain('comic-app')
  expect(MARVEL_USER_AGENT).not.toMatch(/Chrome|Safari|Firefox/)
})

/**
 * The bucket scan looks for the key then the next "{". If Marvel ever renders the comics
 * bucket as something other than an object - "[]" for a quiet week, or null - that scan
 * walks on into the NEXT sibling bucket and parses it as the comics list. The Marvel
 * Unlimited entries it would find carry /comics/issue/ links, so they pass every other
 * check, while their dates are months away from the week asked for.
 */
test('a comics bucket that is not an object throws rather than reading a sibling bucket', () => {
  const html = '<html><script>window.x={"allComicsReleases":[],'
    + '"allMUReleases":{"total":1,"content":[{"headline":"Invented MU (2026) #1",'
    + '"releaseDate":"2026-07-08","isVariant":0,'
    + '"link":{"link":"https://www.marvel.com/comics/issue/999/mu"}}]}}</script></html>'
  expect(() => parseCalendar(html)).toThrow()
})

test('a null comics bucket throws too', () => {
  const html = '<html><script>window.x={"allComicsReleases":null,'
    + '"allMUReleases":{"total":1,"content":[{"headline":"Invented MU (2026) #1",'
    + '"releaseDate":"2026-07-08","isVariant":0,'
    + '"link":{"link":"https://www.marvel.com/comics/issue/999/mu"}}]}}</script></html>'
  expect(() => parseCalendar(html)).toThrow()
})

/**
 * Deduped here rather than only on the way into SQLite, so a cold response and a cached one
 * cannot disagree - the same divergence sortUpcomingIssues exists to prevent, and the one
 * models/releases.ts was already bitten by when Comic Vine repeated an id across pages.
 */
test('a repeated entry is dropped, so a cold read matches a cached one', () => {
  expect(parseCalendar(bucket([ENTRY, ENTRY]))).toHaveLength(1)
})
