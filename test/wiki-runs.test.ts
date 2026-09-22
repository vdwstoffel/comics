import { test, expect } from 'vitest'
import { apiUrl, parseRunsJson, parseRunsHtml, WIKI_PAGES } from '../server/lib/wikiRuns.js'

/**
 * Synthetic, not a capture of the live page: the series names are invented, so these
 * tests pin the page's *structure* and rot only when Wikipedia's markup changes rather
 * than every Wednesday when a real run ends.
 *
 * Every oddity below was measured on the two real pages on 2026-09-22 (see the design
 * spec, §3): full-width group rows inside the tables, a row one cell short, titles with
 * no link, reference superscripts inside cells, and an Upcoming table that must not be
 * mistaken for a running one.
 */
const PAGE = `
<div class="mw-parser-output">
  <h2 id="Ongoing_series">Ongoing series<span class="mw-editsection">[edit]</span></h2>
  <h3 id="Active">Active</h3>
  <table class="wikitable">
    <tbody>
      <tr><th>Title</th><th>Issues</th><th>Pub. Year</th><th>Date of Final Issue</th><th>Ref.</th></tr>
      <tr>
        <td><i><a href="/wiki/Test_Ongoing_One">Test Ongoing One</a></i></td>
        <td>#1–</td><td>2025<sup class="reference"><a href="#cite_note-1">[1]</a></sup></td>
        <td></td><td><sup class="reference">[1]</sup></td>
      </tr>
      <tr>
        <td><i>Test Ongoing Two</i></td>
        <td>#957–1102</td><td>2016</td>
        <td>March 3, 2027</td><td><sup class="reference">[2]</sup></td>
      </tr>
      <tr><th colspan="5">Invented Imprint</th></tr>
      <tr>
        <td><i><a href="/wiki/Test_Ongoing_Three">Test Ongoing Three</a></i></td>
        <td>#1–</td><td>2026</td><td></td><td><sup class="reference">[3]</sup></td>
      </tr>
    </tbody>
  </table>
  <h3 id="Upcoming">Upcoming</h3>
  <table class="wikitable">
    <tbody>
      <tr><th>Title</th><th>Pub. Year</th><th>Date of First Issue</th><th>Ref.</th></tr>
      <tr><td><i>Test Upcoming One</i></td><td>2026</td><td>November 4, 2026</td><td>[4]</td></tr>
    </tbody>
  </table>
  <h2 id="Limited_series">Limited series<span class="mw-editsection">[edit]</span></h2>
  <h3 id="Active_2">Active</h3>
  <table class="wikitable">
    <tbody>
      <tr><th>Pub. Year</th><th>Title</th><th>Issues</th><th>Date of Final Issue</th><th>Ref.</th></tr>
      <tr>
        <td>2026</td><td><i><a href="/wiki/Test_Limited_One">Test Limited One</a></i></td>
        <td>#1–5</td><td>October 21, 2026</td><td><sup class="reference">[5]</sup></td>
      </tr>
      <tr><td>2026</td><td><i>Test Limited Two</i></td><td>#1–5</td></tr>
    </tbody>
  </table>
  <h3 id="Upcoming_2">Upcoming</h3>
  <table class="wikitable">
    <tbody>
      <tr><th>Title</th><th>Issues</th><th>Pub. Year</th><th>Date of First Issue</th><th>Ref.</th></tr>
      <tr><td><i>Test Upcoming Two</i></td><td>#1–4</td><td>2026</td><td>December 2, 2026</td><td>[6]</td></tr>
    </tbody>
  </table>
  <h2 id="See_also">See also<span class="mw-editsection">[edit]</span></h2>
  <ul><li><a href="/wiki/Somewhere">Somewhere</a></li></ul>
</div>
`

const titles = (html: string) => parseRunsHtml(html).map((s) => s.title)

test('WIKI_PAGES names both publishers exactly as the releases route does', () => {
  expect(WIKI_PAGES.map((p) => p.publisher)).toEqual(['Marvel', 'DC Comics'])
})

test('apiUrl asks for the article body alone, as JSON', () => {
  const url = new URL(apiUrl('List_of_current_Marvel_Comics_publications'))
  expect(url.origin + url.pathname).toBe('https://en.wikipedia.org/w/api.php')
  expect(url.searchParams.get('action')).toBe('parse')
  expect(url.searchParams.get('page')).toBe('List_of_current_Marvel_Comics_publications')
  expect(url.searchParams.get('prop')).toBe('text')
  expect(url.searchParams.get('format')).toBe('json')
  expect(url.searchParams.get('formatversion')).toBe('2')
})

test('parseRunsJson pulls the html out of the api envelope', () => {
  expect(parseRunsJson('{"parse":{"text":"<p>hi</p>"}}')).toBe('<p>hi</p>')
})

test('parseRunsJson throws on an api error response rather than returning nothing', () => {
  expect(() => parseRunsJson('{"error":{"code":"missingtitle"}}')).toThrow(/missingtitle/)
})

test('keeps the Active tables of both sections and tags each row with its kind', () => {
  const series = parseRunsHtml(PAGE)
  expect(series.map((s) => [s.title, s.kind])).toEqual([
    ['Test Ongoing One', 'ongoing'],
    ['Test Ongoing Two', 'ongoing'],
    ['Test Ongoing Three', 'ongoing'],
    ['Test Limited One', 'limited'],
    ['Test Limited Two', 'limited'],
  ])
})

test('leaves the Upcoming tables out', () => {
  expect(titles(PAGE)).not.toContain('Test Upcoming One')
  expect(titles(PAGE)).not.toContain('Test Upcoming Two')
})

test('skips the full-width imprint rows inside a table', () => {
  expect(titles(PAGE)).not.toContain('Invented Imprint')
})

test('reads a title that carries no link', () => {
  expect(titles(PAGE)).toContain('Test Ongoing Two')
})

test('strips reference superscripts, so a year is a number', () => {
  const one = parseRunsHtml(PAGE).find((s) => s.title === 'Test Ongoing One')
  expect(one?.pubYear).toBe(2025)
})

test('reads columns by header name, not by position', () => {
  // The limited table puts Pub. Year first and Title second.
  const one = parseRunsHtml(PAGE).find((s) => s.title === 'Test Limited One')
  expect(one).toMatchObject({ pubYear: 2026, issues: '#1–5', endsOn: 'October 21, 2026' })
})

test('a row too short to reach a column yields null, not a shifted value', () => {
  const two = parseRunsHtml(PAGE).find((s) => s.title === 'Test Limited Two')
  expect(two).toMatchObject({ issues: '#1–5', pubYear: 2026, endsOn: null })
})

test('an empty cell is null rather than an empty string', () => {
  const one = parseRunsHtml(PAGE).find((s) => s.title === 'Test Ongoing One')
  expect(one?.endsOn).toBeNull()
})

test('carries an announced final issue through', () => {
  const two = parseRunsHtml(PAGE).find((s) => s.title === 'Test Ongoing Two')
  expect(two?.endsOn).toBe('March 3, 2027')
})

test('a page with no matching sections yields nothing rather than throwing', () => {
  expect(parseRunsHtml('<div><h2>Something else</h2><table class="wikitable"><tr><td>x</td></tr></table></div>')).toEqual([])
})
